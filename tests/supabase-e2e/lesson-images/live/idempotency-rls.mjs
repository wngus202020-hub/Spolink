import { randomUUID } from "node:crypto"

import { createTinyJpeg, createTinyPng } from "../image-fixtures.mjs"
import { expectStatus, hashJson } from "./assertions.mjs"
import { deleteImage, registerIntent, uploadAndRegister } from "./operations.mjs"

export async function idempotencyMatrix(context) {
  const registerLesson = await context.database.createLesson(context.provision)
  const first = await uploadAndRegister(context, registerLesson, createTinyPng(), "image/png")
  expectStatus(context, "duplicate_register_first", first.registration, 201)
  if (first.registration.status === 201) {
    const repeated = await registerIntent(context, registerLesson, "coach", first.intent)
    if (repeated.status !== 201) {
      context.blockers.push({
        actual: repeated.status,
        code: repeated.code,
        criterion: "duplicate_register_idempotency",
        expected: 201,
      })
    }
    if (!(await context.database.objectRowExists(first.intent.objectName))) {
      context.blockers.push({
        actual: "object_removed",
        criterion: "duplicate_register_object_preservation",
        expected: "object_present",
      })
    }
  }

  const deleteLesson = await context.database.createLesson(context.provision)
  const seeded = await uploadAndRegister(context, deleteLesson, createTinyJpeg(), "image/jpeg")
  expectStatus(context, "duplicate_delete_seed", seeded.registration, 201)
  if (seeded.registration.status === 201) {
    const images = seeded.registration.body.data.images
    const firstDelete = await deleteImage(
      context,
      deleteLesson,
      "coach",
      images[0].id,
      images.map((image) => image.id),
    )
    expectStatus(context, "duplicate_delete_first", firstDelete, 200)
    const repeated = await deleteImage(
      context,
      deleteLesson,
      "coach",
      images[0].id,
      images.map((image) => image.id),
    )
    if (repeated.status !== 200) {
      context.blockers.push({
        actual: repeated.status,
        code: repeated.code,
        criterion: "duplicate_delete_idempotency",
        expected: 200,
      })
    }
  }
}

export async function directRlsMatrix(context) {
  const lessonId = await context.database.createLesson(context.provision)
  const seeded = await uploadAndRegister(context, lessonId, createTinyPng(), "image/png")
  expectStatus(context, "rls_seed", seeded.registration, 201)
  if (seeded.registration.status !== 201) return

  const [anonymous, learner, owner] = await Promise.all([
    context.clients.anonymous.from("lesson_images").select("id").eq("lesson_id", lessonId),
    context.clients.learner.from("lesson_images").select("id").eq("lesson_id", lessonId),
    context.clients.coach.from("lesson_images").select("id").eq("lesson_id", lessonId),
  ])
  if (anonymous.error || learner.error || owner.error) throw new Error("RLS read probe failed")
  if (anonymous.data.length !== 0 || learner.data.length !== 0 || owner.data.length !== 1) {
    context.blockers.push({
      actual: hashJson([anonymous.data.length, learner.data.length, owner.data.length]),
      criterion: "draft_image_rls_visibility",
      expected: hashJson([0, 0, 1]),
    })
  }

  const directPath = `${lessonId}/${randomUUID()}.png`
  const direct = await context.clients.coach.from("lesson_images").insert({
    file_path: directPath,
    lesson_id: lessonId,
    lifecycle_state: "ready",
    sort_order: 1,
  })
  if (!direct.error) {
    context.blockers.push({
      actual: "direct_insert_allowed",
      criterion: "lesson_image_direct_mutation_revoked",
      expected: "rejected",
    })
  }
}
