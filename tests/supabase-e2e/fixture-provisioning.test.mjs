import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"

import { createClient } from "@supabase/supabase-js"
import postgres from "postgres"

import { parseSupabaseStatus } from "../../scripts/supabase-local.mjs"
import { buildFixtureRows, fixtureEmails } from "./fixtures.mjs"
import { readGuardedLocalStatus } from "./local-status.mjs"
import { assertFixtureGraph, provisionFixtures, readFixtureCounts } from "./provision.mjs"

test("rejects hosted status before Auth or database access", async () => {
  await assert.rejects(
    readGuardedLocalStatus({
      statusJson: JSON.stringify({
        API_URL: "https://example.supabase.co",
        DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
        SECRET_KEY: "sb_secret_abcdefghijklmnopqrstuvwxyz",
      }),
    }),
    /loopback/i,
  )
  assert.throws(
    () =>
      parseSupabaseStatus(
        JSON.stringify({
          API_URL: "http://127.0.0.1:54321",
          DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
          PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
          SECRET_KEY: "sb_secret_abcdefghijklmnopqrstuvwxyz",
        }),
        { projectId: "hosted" },
      ),
    /project id/i,
  )
  await assert.rejects(
    readGuardedLocalStatus({
      statusJson: JSON.stringify({
        API_URL: "http://127.0.0.1:54321",
        DB_URL: "postgresql://postgres:postgres@example.supabase.co:54322/postgres",
        PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
        SECRET_KEY: "sb_secret_abcdefghijklmnopqrstuvwxyz",
      }),
    }),
    /loopback/i,
  )
  await assert.rejects(
    readGuardedLocalStatus({
      statusJson: JSON.stringify({
        DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
        SECRET_KEY: "sb_secret_abcdefghijklmnopqrstuvwxyz",
      }),
    }),
    /API_URL/i,
  )
  await assert.rejects(
    readGuardedLocalStatus({
      statusJson: JSON.stringify({
        API_URL: "http://127.0.0.1:54321",
        DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
      }),
    }),
    /complete/i,
  )
})

test("rejects missing profile Auth UUID before inserting fixture graph", async () => {
  assert.throws(
    () =>
      buildFixtureRows({
        epoch: new Date("2026-07-17T00:00:00.000Z"),
        tennisSportId: "00000000-0000-4000-8000-000000009999",
        authIds: {
          learner: "00000000-0000-4000-8000-000000000001",
          otherLearner: "00000000-0000-4000-8000-000000000002",
          coach: "00000000-0000-4000-8000-000000000003",
          admin: "00000000-0000-4000-8000-000000000004",
        },
      }),
    /pendingCoach/i,
  )
})

test("provisions fresh GoTrue users and deterministic relational fixtures twice", async () => {
  const status = await readGuardedLocalStatus()
  const serviceClient = createClient(status.apiUrl, status.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const unrelatedEmail = `unrelated-${randomUUID()}@example.test`
  const unrelatedPassword = `Spolink-${randomUUID()}-1a!`
  const { data: unrelatedData, error: unrelatedError } = await serviceClient.auth.admin.createUser({
    email: unrelatedEmail,
    password: unrelatedPassword,
    email_confirm: true,
  })
  assert.ifError(unrelatedError)
  const unrelatedUserId = unrelatedData.user.id

  const first = await provisionFixtures({ status })
  const firstAuthIds = first.authIds
  const firstPassword = first.runPassword
  const firstPasswordHash = first.passwordSha256
  await first.cleanup()

  const second = await provisionFixtures({ status })
  const sql = postgres(second.status.dbUrl, { max: 1, idle_timeout: 1 })
  const anonClient = createClient(second.status.apiUrl, second.status.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  try {
    assert.notDeepEqual(second.authIds, firstAuthIds)
    assert.notEqual(second.passwordSha256, firstPasswordHash)

    for (const email of fixtureEmails) {
      const { error } = await anonClient.auth.signInWithPassword({
        email,
        password: firstPassword,
      })
      assert.match(error?.message ?? "", /invalid|credentials|login/i)
    }

    for (const fixture of fixtureEmails) {
      const { data, error } = await anonClient.auth.signInWithPassword({
        email: fixture,
        password: second.runPassword,
      })
      assert.ifError(error)
      assert.ok(Object.values(second.authIds).includes(data.user.id))
      await anonClient.auth.signOut()
    }

    for (const id of Object.values(firstAuthIds)) {
      const [row] = await sql`
        select
          (select count(*)::int from auth.users where id = ${id}) as "authUsers",
          (select count(*)::int from public.profiles where id = ${id}) as "profiles"
      `
      assert.deepEqual(row, { authUsers: 0, profiles: 0 })
    }

    await assertFixtureGraph(sql, second.rows, second.authIds)

    const counts = await readFixtureCounts(sql)
    assert.equal(counts.profiles, 5)
    assert.equal(counts.coachProfiles, 2)
    assert.equal(counts.lessons, 1)
    assert.equal(counts.schedules, 13)
    assert.equal(counts.reservations, 13)
    assert.equal(counts.payments, 13)
    assert.equal(counts.refunds, 1)
    assert.equal(counts.notifications, 0)
    assert.equal(counts.auditLogs, 0)

    const [authRow] = await sql`
      select
        (select count(*)::int from auth.users where email in ${sql(fixtureEmails)}) as "fixtureAuthUsers",
        (select count(*)::int from auth.users where id = ${unrelatedUserId}) as "unrelatedAuthUsers"
    `
    assert.deepEqual(authRow, { fixtureAuthUsers: 5, unrelatedAuthUsers: 1 })
  } finally {
    await anonClient.auth.signOut()
    await sql.end({ timeout: 1 })
    await second.cleanup()
    await serviceClient.auth.admin.deleteUser(unrelatedUserId)
  }
})
