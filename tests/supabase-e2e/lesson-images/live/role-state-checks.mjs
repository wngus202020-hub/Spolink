import { requestJson, uploadSigned } from "../http-client.mjs"
import { createTinyJpeg, createTinyPng, createTinyWebp } from "../image-fixtures.mjs"
import { expectStatus, hashJson, recordMutation } from "./assertions.mjs"
import {
  activateLesson,
  cancelIntentTwice,
  deleteImage,
  imageIntentPath,
  issueIntent,
  registerIntent,
  reorderImages,
  uploadAndRegister,
} from "./operations.mjs"

export async function roleAndBoundaryMatrix(context) {
  const draft = await context.database.createLesson(context.provision)
  const rejected = await context.database.createLesson(context.provision, { state: "rejected" })
  const foreign = await context.database.createLesson(context.provision, {
    coachProfileId: context.foreignCoachProfileId,
  })

  for (const [actor, expected] of [
    [null, 401],
    ["learner", 403],
    ["pendingCoach", 403],
    ["otherLearner", 403],
    ["admin", 403],
  ]) {
    const result = await issueIntent(context, draft, actor, "image/png", createTinyPng().length)
    expectStatus(context, `role_${actor ?? "anonymous"}`, result, expected)
  }

  const rawOwner = await issueIntent(context, draft, "coach", "image/png", createTinyPng().length)
  if (rawOwner.status !== 201) {
    context.blockers.push({
      actual: rawOwner.status,
      code: rawOwner.code,
      criterion: "upload_intent_iso_offset_runtime",
      expected: 201,
    })
  }
  const direct = await context.clients.coach.rpc("create_lesson_image_upload_intent", {
    checked_lesson_id: draft,
    checked_mime_type: "image/png",
    checked_size_bytes: createTinyPng().length,
  })
  const row = direct.data?.[0]
  context.observations.push({
    bodySha256: hashJson({
      error: direct.error ? `${direct.error.code}:${direct.error.message}` : null,
      expiresHasOffset: /[+-][0-9]{2}:[0-9]{2}$/u.test(row?.expires_at ?? ""),
      expiresHasZulu: row?.expires_at?.endsWith("Z") ?? false,
      sizeType: typeof row?.size_bytes,
    }),
    label: "upload_intent_rpc_runtime_shape",
    status: direct.error ? 500 : 200,
  })
  for (const intent of await context.database.readIntents(draft)) {
    if (intent.status !== "pending") continue
    const cancelled = await context.clients.coach.rpc("cancel_lesson_image_upload_intent", {
      checked_intent_id: intent.id,
      checked_lesson_id: draft,
      checked_object_name: intent.object_name,
    })
    if (cancelled.error) throw cancelled.error
  }
  context.proxy.normalizeIntentTimestamps()

  const foreignOwner = await issueIntent(
    context,
    foreign,
    "otherLearner",
    "image/png",
    createTinyPng().length,
  )
  expectStatus(context, "foreign_approved_owner", foreignOwner, 201)
  if (foreignOwner.status === 201) {
    await cancelIntentTwice(context, "otherLearner", foreign, foreignOwner.body.data)
  }

  for (const lessonId of [draft, rejected]) {
    const editable = await issueIntent(
      context,
      lessonId,
      "coach",
      "image/png",
      createTinyPng().length,
    )
    expectStatus(context, "owner_editable_state", editable, 201)
    if (editable.status === 201) {
      await cancelIntentTwice(context, "coach", lessonId, editable.body.data)
    }
  }

  for (const state of ["pending_review", "active", "paused", "closed"]) {
    const lessonId = await context.database.createLesson(context.provision, { state })
    const result = await issueIntent(
      context,
      lessonId,
      "coach",
      "image/png",
      createTinyPng().length,
    )
    expectStatus(context, `owner_${state}`, result, 403)
  }

  const crossOrigin = await requestJson(context.next.baseUrl, imageIntentPath(draft), {
    body: { mimeType: "image/png", sizeBytes: createTinyPng().length },
    jar: context.jars.coach,
    origin: "https://invalid.example",
  })
  recordMutation(context, "cross_origin", crossOrigin)
  expectStatus(context, "cross_origin", crossOrigin, 403)
  const missingType = await requestJson(context.next.baseUrl, imageIntentPath(draft), {
    body: { mimeType: "image/png", sizeBytes: createTinyPng().length },
    contentType: null,
    jar: context.jars.coach,
  })
  recordMutation(context, "missing_content_type", missingType)
  expectStatus(context, "missing_content_type", missingType, 415)
  const malformed = await requestJson(context.next.baseUrl, imageIntentPath(draft), {
    body: "{",
    jar: context.jars.coach,
  })
  recordMutation(context, "malformed_json", malformed)
  expectStatus(context, "malformed_json", malformed, 422)
}

export async function mutationAuthorizationMatrix(context) {
  const registerLesson = await context.database.createLesson(context.provision)
  const issued = await issueIntent(
    context,
    registerLesson,
    "coach",
    "image/png",
    createTinyPng().length,
  )
  expectStatus(context, "register_authorization_intent", issued, 201)
  if (issued.status === 201) {
    for (const [actor, expected] of [
      [null, 401],
      ["learner", 404],
      ["pendingCoach", 404],
      ["otherLearner", 404],
      ["admin", 404],
    ]) {
      const result = await registerIntent(context, registerLesson, actor, issued.body.data)
      expectStatus(context, `register_role_${actor ?? "anonymous"}`, result, expected)
    }
    const uploaded = await uploadSigned(
      context.clients.coach,
      issued.body.data,
      createTinyPng(),
      "image/png",
    )
    if (uploaded.error) throw new Error("Authorization owner registration upload failed")
    const owner = await registerIntent(context, registerLesson, "coach", issued.body.data)
    expectStatus(context, "register_role_owner_draft", owner, 201)
  }

  const mutationLesson = await context.database.createLesson(context.provision)
  for (let index = 0; index < 2; index += 1) {
    const seeded = await uploadAndRegister(context, mutationLesson, createTinyPng(), "image/png")
    expectStatus(context, `mutation_authorization_seed_${index + 1}`, seeded.registration, 201)
  }
  const mutationImages = await context.database.readImages(mutationLesson)
  const expectedIds = mutationImages.map((image) => image.id)
  for (const [actor, expected] of [
    [null, 401],
    ["learner", 403],
    ["pendingCoach", 403],
    ["otherLearner", 403],
    ["admin", 403],
  ]) {
    const reorder = await reorderImages(context, mutationLesson, actor, expectedIds, [
      expectedIds[1],
      expectedIds[0],
    ])
    expectStatus(context, `reorder_role_${actor ?? "anonymous"}`, reorder, expected)
    const deleted = await deleteImage(
      context,
      mutationLesson,
      actor,
      mutationImages[0].id,
      expectedIds,
    )
    expectStatus(context, `delete_role_${actor ?? "anonymous"}`, deleted, expected)
  }

  const rejectedLesson = await context.database.createLesson(context.provision, {
    state: "rejected",
  })
  for (let index = 0; index < 2; index += 1) {
    const seeded = await uploadAndRegister(context, rejectedLesson, createTinyJpeg(), "image/jpeg")
    expectStatus(context, `register_role_owner_rejected_${index + 1}`, seeded.registration, 201)
  }
  const rejectedImages = await context.database.readImages(rejectedLesson)
  const rejectedIds = rejectedImages.map((image) => image.id)
  const rejectedReorder = await reorderImages(context, rejectedLesson, "coach", rejectedIds, [
    rejectedIds[1],
    rejectedIds[0],
  ])
  expectStatus(context, "reorder_role_owner_rejected", rejectedReorder, 200)
  const rejectedCurrent = await context.database.readImages(rejectedLesson)
  const rejectedDelete = await deleteImage(
    context,
    rejectedLesson,
    "coach",
    rejectedCurrent[0].id,
    rejectedCurrent.map((image) => image.id),
  )
  expectStatus(context, "delete_role_owner_rejected", rejectedDelete, 200)

  const activeLesson = await context.database.createLesson(context.provision, {
    withSchedule: true,
  })
  const activeSeed = await uploadAndRegister(context, activeLesson, createTinyWebp(), "image/webp")
  expectStatus(context, "active_authorization_seed", activeSeed.registration, 201)
  if (activeSeed.registration.status === 201) {
    await activateLesson(context, activeLesson)
    const activeImages = await context.database.readImages(activeLesson)
    const activeIds = activeImages.map((image) => image.id)
    const activeReorder = await reorderImages(context, activeLesson, "coach", activeIds, activeIds)
    expectStatus(context, "reorder_role_owner_active", activeReorder, 403)
    const activeDelete = await deleteImage(
      context,
      activeLesson,
      "coach",
      activeImages[0].id,
      activeIds,
    )
    expectStatus(context, "delete_role_owner_active", activeDelete, 403)
  }
}
