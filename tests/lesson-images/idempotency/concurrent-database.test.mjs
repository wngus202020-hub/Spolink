import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"

import { createClient } from "@supabase/supabase-js"
import postgres from "postgres"

import { readGuardedLocalStatus } from "../../../scripts/supabase-local/local-status.mjs"
import {
  beginDeleteInTransaction,
  finalizeDeleteInTransaction,
  provisionDatabaseFixture,
  registerInTransaction,
  removeDatabaseFixture,
} from "./database-fixture.mjs"

test("concurrent exact registration and deletion retries preserve one object then remove it safely", {
  skip: process.env.SPOLINK_LESSON_IMAGE_DB_TEST !== "1",
}, async () => {
  const status = await readGuardedLocalStatus()
  const sql = postgres(status.dbUrl, { max: 4, prepare: false })
  const service = createClient(status.apiUrl, status.serviceRoleKey, {
    auth: { persistSession: false },
  })
  const fixture = {
    coachProfileId: randomUUID(),
    intentId: randomUUID(),
    lessonId: randomUUID(),
    userId: randomUUID(),
  }
  fixture.objectName = `${fixture.lessonId}/${randomUUID()}.png`

  try {
    const sport = await provisionDatabaseFixture(sql, fixture)
    assert.ok(sport?.id)

    const firstRace = await Promise.all([
      registerInTransaction(sql, fixture),
      registerInTransaction(sql, fixture),
    ])
    const secondRace = await Promise.all([
      registerInTransaction(sql, fixture),
      registerInTransaction(sql, fixture),
    ])
    const ids = [...firstRace, ...secondRace].map((rows) => rows[0]?.id)
    const [state] = await sql`
      select
        (select count(*)::integer from public.lesson_images
         where lesson_id = ${fixture.lessonId}) as image_count,
        (select count(*)::integer from storage.objects
         where bucket_id = 'lesson-images' and name = ${fixture.objectName}) as object_count,
        (select registered_image_id::text from public.lesson_image_upload_intents
         where id = ${fixture.intentId}) as registered_image_id
    `

    assert.ok(ids[0])
    assert.deepEqual(ids, Array(4).fill(ids[0]))
    assert.equal(state?.image_count, 1)
    assert.equal(state?.object_count, 1)
    assert.equal(state?.registered_image_id, ids[0])

    const deleteInput = {
      ...fixture,
      expectedImageIds: [ids[0]],
      imageId: ids[0],
    }
    const begun = await Promise.all([
      beginDeleteInTransaction(sql, deleteInput),
      beginDeleteInTransaction(sql, deleteInput),
    ])
    assert.deepEqual(
      begun.map((rows) => rows[0]?.file_path),
      [fixture.objectName, fixture.objectName],
    )
    const firstRemoval = await service.storage.from("lesson-images").remove([fixture.objectName])
    const retryRemoval = await service.storage.from("lesson-images").remove([fixture.objectName])
    assert.equal(firstRemoval.error, null)
    assert.equal(retryRemoval.error, null)

    const finalized = await Promise.all([
      finalizeDeleteInTransaction(sql, deleteInput),
      finalizeDeleteInTransaction(sql, deleteInput),
    ])
    assert.deepEqual(
      finalized.map((rows) => rows.length),
      [0, 0],
    )
    await assert.rejects(
      beginDeleteInTransaction(sql, { ...deleteInput, imageId: randomUUID() }),
      /LESSON_IMAGE_NOT_FOUND/u,
    )
    const [deletedState] = await sql`
      select
        (select count(*)::integer from public.lesson_images
         where lesson_id = ${fixture.lessonId}) as image_count,
        (select count(*)::integer from storage.objects
         where bucket_id = 'lesson-images' and name = ${fixture.objectName}) as object_count,
        (select count(*)::integer from public.lesson_image_deletion_receipts
         where lesson_id = ${fixture.lessonId}) as receipt_count
    `
    assert.deepEqual(deletedState, { image_count: 0, object_count: 0, receipt_count: 1 })
  } finally {
    try {
      await removeDatabaseFixture(sql, service, fixture)
    } finally {
      await sql.end({ timeout: 5 })
    }
  }
})
