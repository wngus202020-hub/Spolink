import { publicObjectUrl, uploadSigned, upsertAuthenticated } from "../http-client.mjs"
import { createExactPng, createTinyJpeg, FIVE_MIB } from "../image-fixtures.mjs"
import { canonicalObjectName, expectStatus, hashJson, sha256Bytes } from "./assertions.mjs"
import { issueIntent, registerIntent, uploadAndRegister } from "./operations.mjs"

export async function formatBoundaryAndCompensation(context) {
  const boundaryLesson = await context.database.createLesson(context.provision)
  const zero = await issueIntent(context, boundaryLesson, "coach", "image/png", 0)
  expectStatus(context, "zero_byte_intent", zero, 422)
  const tooLarge = await issueIntent(context, boundaryLesson, "coach", "image/png", FIVE_MIB + 1)
  expectStatus(context, "oversize_intent", tooLarge, 422)

  const exactLesson = await context.database.createLesson(context.provision)
  const exactBytes = createExactPng(FIVE_MIB)
  const exact = await uploadAndRegister(context, exactLesson, exactBytes, "image/png")
  expectStatus(context, "five_mib_register", exact.registration, 201)

  const bucketLesson = await context.database.createLesson(context.provision)
  const signed = await issueIntent(context, bucketLesson, "coach", "image/png", FIVE_MIB)
  expectStatus(context, "oversize_bucket_sign", signed, 201)
  if (signed.status === 201) {
    const upload = await uploadSigned(
      context.clients.coach,
      signed.body.data,
      createExactPng(FIVE_MIB + 1),
      "image/png",
    )
    if (!upload.error) {
      context.blockers.push({
        actual: "accepted",
        criterion: "bucket_5mib_plus_one",
        expected: "rejected",
      })
    }
    const registration = await registerIntent(context, bucketLesson, "coach", signed.body.data)
    expectStatus(context, "oversize_bucket_registration", registration, 404)
  }

  for (const [label, mimeType, bytes] of [
    ["spoof", "image/jpeg", Buffer.alloc(createTinyJpeg().length, 0x41)],
    ["mismatch", "image/png", createTinyJpeg()],
  ]) {
    const lessonId = await context.database.createLesson(context.provision)
    const intent = await issueIntent(context, lessonId, "coach", mimeType, bytes.length)
    expectStatus(context, `${label}_intent`, intent, 201)
    if (intent.status !== 201) continue
    const upload = await uploadSigned(context.clients.coach, intent.body.data, bytes, mimeType)
    if (upload.error) {
      context.blockers.push({
        actual: "upload_rejected_before_verification",
        criterion: `${label}_server_signature_verification`,
        expected: "upload_then_422_register",
      })
      continue
    }
    const registration = await registerIntent(context, lessonId, "coach", intent.body.data)
    expectStatus(context, `${label}_registration`, registration, 422)
    const rows = await context.database.readIntents(lessonId)
    if (rows.at(-1)?.status !== "cancelled") {
      context.blockers.push({
        actual: rows.at(-1)?.status ?? "missing",
        criterion: `${label}_intent_compensation`,
        expected: "cancelled",
      })
    }
    if (await context.database.objectRowExists(intent.body.data.objectName)) {
      context.blockers.push({
        actual: "object_present",
        criterion: `${label}_object_compensation`,
        expected: "object_removed",
      })
    }
  }

  const immutableLesson = await context.database.createLesson(context.provision)
  const immutable = await issueIntent(
    context,
    immutableLesson,
    "coach",
    "image/jpeg",
    createTinyJpeg().length,
  )
  expectStatus(context, "immutable_path_intent", immutable, 201)
  if (immutable.status === 201) {
    const intent = immutable.body.data
    const originalBytes = createTinyJpeg()
    const replacementBytes = Buffer.from(originalBytes)
    replacementBytes[replacementBytes.length - 1] ^= 1
    context.database.trackObject(intent.objectName)
    if (!canonicalObjectName(intent.objectName, immutableLesson, "jpg")) {
      context.blockers.push({
        actual: "noncanonical",
        criterion: "immutable_server_path",
        expected: "lesson/object.jpg",
      })
    }
    const first = await uploadSigned(context.clients.coach, intent, originalBytes, "image/jpeg")
    if (first.error) throw new Error("First immutable signed upload failed")
    const signedReplay = await uploadSigned(
      context.clients.coach,
      intent,
      replacementBytes,
      "image/jpeg",
    )
    if (!signedReplay.error) {
      context.blockers.push({
        actual: "replay_succeeded",
        criterion: "signed_upload_token_replay",
        expected: "replay_rejected",
      })
    }
    const signedUpsert = await uploadSigned(
      context.clients.coach,
      intent,
      replacementBytes,
      "image/jpeg",
      { upsert: true },
    )
    if (!signedUpsert.error) {
      context.blockers.push({
        actual: "signed_upsert_succeeded",
        criterion: "signed_upload_upsert",
        expected: "upsert_rejected",
      })
    }
    const ownerUpsert = await upsertAuthenticated(
      context.clients.coach,
      intent.objectName,
      replacementBytes,
      "image/jpeg",
    )
    if (!ownerUpsert.error) {
      context.blockers.push({
        actual: "owner_upsert_succeeded",
        criterion: "authenticated_owner_storage_update",
        expected: "update_rejected",
      })
    }
    const storedResponse = await fetch(
      publicObjectUrl(context.provision.status.apiUrl, intent.objectName),
    )
    const storedBytes = Buffer.from(await storedResponse.arrayBuffer())
    const originalSha256 = sha256Bytes(originalBytes)
    const storedSha256 = sha256Bytes(storedBytes)
    context.observations.push({
      bodySha256: hashJson({
        originalPreserved: storedSha256 === originalSha256,
        ownerUpsertRejected: Boolean(ownerUpsert.error),
        signedReplayRejected: Boolean(signedReplay.error),
        signedUpsertRejected: Boolean(signedUpsert.error),
      }),
      label: "immutable_pending_object",
      status: storedResponse.status,
    })
    if (!storedResponse.ok || storedSha256 !== originalSha256) {
      context.blockers.push({
        actual: storedResponse.ok ? "bytes_changed" : storedResponse.status,
        criterion: "immutable_original_bytes",
        expected: "original_bytes_preserved",
      })
    }
    const registration = await registerIntent(context, immutableLesson, "coach", intent)
    expectStatus(context, "immutable_registration", registration, 201)
    if (registration.status === 201) {
      const duplicate = await registerIntent(context, immutableLesson, "coach", intent)
      expectStatus(context, "immutable_duplicate_registration", duplicate, 201)
    }
  }
}
