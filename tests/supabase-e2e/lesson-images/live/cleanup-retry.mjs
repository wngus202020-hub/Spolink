import { publicObjectUrl, uploadSigned } from "../http-client.mjs"
import { createTinyJpeg, createTinyPng, createTinyWebp } from "../image-fixtures.mjs"
import { expectStatus, hashJson } from "./assertions.mjs"
import { convergeOwnedExpiredIntent } from "./cleanup-convergence.mjs"
import { deleteImage, issueIntent, registerIntent, uploadAndRegister } from "./operations.mjs"

export async function cleanupAndRetryMatrix(context) {
  await cleanupAbandonedIntent(context)

  const registrationFailureLesson = await context.database.createLesson(context.provision)
  const registrationFailure = await issueIntent(
    context,
    registrationFailureLesson,
    "coach",
    "image/png",
    createTinyPng().length,
  )
  expectStatus(context, "registration_failure_intent", registrationFailure, 201)
  if (registrationFailure.status === 201) {
    const intent = registrationFailure.body.data
    context.database.trackObject(intent.objectName)
    const upload = await uploadSigned(context.clients.coach, intent, createTinyPng(), "image/png")
    if (upload.error) throw new Error("Registration failure fixture upload failed")
    context.proxy.failNext("register_rpc")
    const failed = await registerIntent(context, registrationFailureLesson, "coach", intent)
    expectStatus(context, "registration_rpc_failure", failed, 503)
    const rows = await context.database.readIntents(registrationFailureLesson)
    if (
      rows.at(-1)?.status !== "cancelled" ||
      (await context.database.objectRowExists(intent.objectName))
    ) {
      context.blockers.push({
        actual: rows.at(-1)?.status ?? "missing",
        criterion: "registration_failure_compensation",
        expected: "cancelled_and_object_absent",
      })
    }
    const replacement = await uploadAndRegister(
      context,
      registrationFailureLesson,
      createTinyPng(),
      "image/png",
    )
    expectStatus(context, "registration_failure_capacity_released", replacement.registration, 201)
  }

  const storageFailureLesson = await context.database.createLesson(context.provision)
  const storageSeed = await uploadAndRegister(
    context,
    storageFailureLesson,
    createTinyJpeg(),
    "image/jpeg",
  )
  expectStatus(context, "storage_delete_seed", storageSeed.registration, 201)
  if (storageSeed.registration.status === 201) {
    const images = storageSeed.registration.body.data.images
    context.proxy.failNext("storage_delete")
    const failed = await deleteImage(
      context,
      storageFailureLesson,
      "coach",
      images[0].id,
      images.map((image) => image.id),
    )
    expectStatus(context, "storage_delete_failure", failed, 503)
    const deleting = await context.database.readImages(storageFailureLesson)
    if (deleting[0]?.lifecycle_state !== "deleting") {
      context.blockers.push({
        actual: deleting[0]?.lifecycle_state ?? "missing",
        criterion: "storage_failure_retry_state",
        expected: "deleting",
      })
    }
    const retried = await deleteImage(
      context,
      storageFailureLesson,
      "coach",
      images[0].id,
      images.map((image) => image.id),
    )
    expectStatus(context, "storage_delete_retry", retried, 200)
  }

  const finalizeFailureLesson = await context.database.createLesson(context.provision)
  const finalizeSeed = await uploadAndRegister(
    context,
    finalizeFailureLesson,
    createTinyWebp(),
    "image/webp",
  )
  expectStatus(context, "finalize_delete_seed", finalizeSeed.registration, 201)
  if (finalizeSeed.registration.status === 201) {
    const images = finalizeSeed.registration.body.data.images
    const objectName = images[0].objectName
    context.proxy.failNext("finalize_delete_rpc")
    const failed = await deleteImage(
      context,
      finalizeFailureLesson,
      "coach",
      images[0].id,
      images.map((image) => image.id),
    )
    expectStatus(context, "finalize_delete_failure", failed, 503)
    const objectResponse = await fetch(publicObjectUrl(context.proxiedStatus.apiUrl, objectName))
    const objectExists = await context.database.objectRowExists(objectName)
    if (objectExists || objectResponse.status === 200) {
      context.blockers.push({
        actual: hashJson({ objectExists, status: objectResponse.status }),
        criterion: "finalize_failure_object_removed",
        expected: hashJson({ objectExists: false, status: "not_200" }),
      })
    }
    const retried = await deleteImage(
      context,
      finalizeFailureLesson,
      "coach",
      images[0].id,
      images.map((image) => image.id),
    )
    expectStatus(context, "finalize_delete_retry_after_object_404", retried, 200)
  }

  if (context.proxy.pendingFaults() !== 0) {
    context.blockers.push({
      actual: context.proxy.pendingFaults(),
      criterion: "fault_injection_consumption",
      expected: 0,
    })
  }
}

async function cleanupAbandonedIntent(context) {
  const abandonedLesson = await context.database.createLesson(context.provision)
  const abandoned = await issueIntent(
    context,
    abandonedLesson,
    "coach",
    "image/webp",
    createTinyWebp().length,
  )
  expectStatus(context, "abandoned_intent", abandoned, 201)
  if (abandoned.status === 201) {
    const intent = abandoned.body.data
    context.database.trackObject(intent.objectName)
    const upload = await uploadSigned(context.clients.coach, intent, createTinyWebp(), "image/webp")
    if (upload.error) throw new Error("Abandoned upload failed")
    await context.database.expireIntent(intent.intentId)
    const cleanup = await convergeOwnedExpiredIntent({
      readState: async () => {
        const rows = await context.database.readIntents(abandonedLesson)
        return {
          intentStatus: rows.at(-1)?.status ?? "missing",
          objectExists: await context.database.objectRowExists(intent.objectName),
        }
      },
      runBatch: () => runExpiredCleanup(context, 10),
    })
    context.observations.push({
      bodySha256: hashJson(cleanup),
      label: "expired_intent_cleanup_converged",
      status: 200,
    })
  }
}

export async function runExpiredCleanup(context, limit) {
  const service = context.provision.clients.serviceClient
  const { data: claims, error: claimError } = await service.rpc(
    "claim_expired_lesson_image_upload_intents",
    { checked_limit: limit },
  )
  if (claimError) throw claimError
  let cleaned = 0
  let failed = 0
  for (const claim of claims ?? []) {
    const { error: removeError } = await service.storage
      .from("lesson-images")
      .remove([claim.object_name])
    const { error: finalizeError } = await service.rpc(
      "finalize_lesson_image_upload_intent_cleanup",
      {
        checked_claim_token: claim.claim_token,
        checked_cleaned: !removeError,
        checked_intent_id: claim.id,
      },
    )
    if (!removeError && !finalizeError) cleaned += 1
    else failed += 1
  }
  return { claimed: claims?.length ?? 0, cleaned, failed }
}
