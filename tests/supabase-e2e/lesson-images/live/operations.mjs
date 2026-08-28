import { requestJson, uploadSigned } from "../http-client.mjs"
import { expectStatus, recordMutation, syntheticResult } from "./assertions.mjs"

export async function activateLesson(context, lessonId) {
  const draft = await context.database.readLesson(lessonId)
  const submitted = await requestJson(context.next.baseUrl, `/api/lessons/${lessonId}/status`, {
    body: { action: "submit", expectedUpdatedAt: draft.updated_at },
    jar: context.jars.coach,
  })
  recordMutation(context, "activate_submit", submitted)
  expectStatus(context, "activate_submit", submitted, 200)
  if (submitted.status !== 200) return
  const pending = await context.database.readLesson(lessonId)
  const approved = await requestJson(context.next.baseUrl, `/api/lessons/${lessonId}/status`, {
    body: { action: "approve", expectedUpdatedAt: pending.updated_at },
    jar: context.jars.admin,
  })
  recordMutation(context, "activate_approve", approved)
  expectStatus(context, "activate_approve", approved, 200)
}

export async function uploadAndRegister(context, lessonId, bytes, mimeType) {
  const issued = await issueIntent(context, lessonId, "coach", mimeType, bytes.length)
  if (issued.status !== 201) {
    return { intent: null, intentStatus: issued.status, registration: issued, uploadStatus: 0 }
  }
  const intent = issued.body.data
  context.database.trackObject(intent.objectName)
  const upload = await uploadSigned(context.clients.coach, intent, bytes, mimeType)
  if (upload.error) {
    return {
      intent,
      intentStatus: issued.status,
      registration: syntheticResult(599, "UPLOAD_FAILED"),
      uploadStatus: Number(upload.error.statusCode ?? upload.error.status ?? 599),
    }
  }
  const registration = await registerIntent(context, lessonId, "coach", intent)
  return { intent, intentStatus: issued.status, registration, uploadStatus: 200 }
}

export async function issueIntent(context, lessonId, actor, mimeType, sizeBytes) {
  const result = await requestJson(context.next.baseUrl, imageIntentPath(lessonId), {
    body: { mimeType, sizeBytes },
    jar: actor ? context.jars[actor] : null,
  })
  recordMutation(context, `intent_${actor ?? "anonymous"}`, result)
  if (result.status === 201) context.database.trackObject(result.body.data.objectName)
  return result
}

export async function registerIntent(context, lessonId, actor, intent) {
  const result = await requestJson(context.next.baseUrl, `/api/lessons/${lessonId}/images`, {
    body: { intentId: intent.intentId, objectName: intent.objectName },
    jar: actor ? context.jars[actor] : null,
  })
  recordMutation(context, `register_${actor}`, result)
  return result
}

export async function reorderImages(context, lessonId, actor, expectedImageIds, orderedImageIds) {
  const result = await requestJson(context.next.baseUrl, `/api/lessons/${lessonId}/images/order`, {
    body: { expectedImageIds, orderedImageIds },
    jar: actor ? context.jars[actor] : null,
    method: "PATCH",
  })
  recordMutation(context, `reorder_${actor ?? "anonymous"}`, result)
  return result
}

export async function deleteImage(context, lessonId, actor, imageId, expectedImageIds) {
  const result = await requestJson(
    context.next.baseUrl,
    `/api/lessons/${lessonId}/images/${imageId}`,
    {
      body: { expectedImageIds },
      jar: actor ? context.jars[actor] : null,
      method: "DELETE",
    },
  )
  recordMutation(context, `delete_${actor ?? "anonymous"}`, result)
  return result
}

export async function cancelIntentTwice(context, actor, lessonId, intent) {
  const args = {
    checked_intent_id: intent.intentId,
    checked_lesson_id: lessonId,
    checked_object_name: intent.objectName,
  }
  const first = await context.clients[actor].rpc("cancel_lesson_image_upload_intent", args)
  const second = await context.clients[actor].rpc("cancel_lesson_image_upload_intent", args)
  if (first.error || second.error || first.data?.length !== 1 || second.data?.length !== 1) {
    context.blockers.push({
      actual: "cancel_retry_failed",
      criterion: "duplicate_cancel_idempotency",
      expected: "two_successes",
    })
  }
}

export function imageIntentPath(lessonId) {
  return `/api/lessons/${lessonId}/images/upload-intents`
}
