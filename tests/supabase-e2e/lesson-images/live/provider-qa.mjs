import { requestJson } from "../http-client.mjs"
import { expectStatus, hashJson } from "./assertions.mjs"
import { MIME_FIXTURES } from "./image-cases.mjs"
import { activateLesson, deleteImage, uploadAndRegister } from "./operations.mjs"

export async function manualProviderQa(context) {
  const lessonId = await context.database.createLesson(context.provision, { withSchedule: true })
  const statuses = []
  for (const [mimeType, createBytes] of MIME_FIXTURES) {
    const result = await uploadAndRegister(context, lessonId, createBytes(), mimeType)
    statuses.push(result.intentStatus, result.uploadStatus, result.registration.status)
    expectStatus(context, `manual_register_${mimeType}`, result.registration, 201)
  }
  const rows = await context.database.readImages(lessonId)
  const expected = rows.map((row) => row.id)
  const reordered = await requestJson(
    context.next.baseUrl,
    `/api/lessons/${lessonId}/images/order`,
    {
      body: {
        expectedImageIds: expected,
        orderedImageIds: [expected[2], expected[0], expected[1]],
      },
      jar: context.jars.coach,
      method: "PATCH",
    },
  )
  statuses.push(reordered.status)
  expectStatus(context, "manual_reorder", reordered, 200)
  const current = await context.database.readImages(lessonId)
  const deleted = await deleteImage(
    context,
    lessonId,
    "coach",
    current[0].id,
    current.map((image) => image.id),
  )
  statuses.push(deleted.status)
  expectStatus(context, "manual_delete", deleted, 200)
  await activateLesson(context, lessonId)
  const publicGet = await requestJson(context.next.baseUrl, `/api/lessons/${lessonId}`, {
    contentType: null,
    method: "GET",
    origin: false,
  })
  statuses.push(publicGet.status)
  if (publicGet.status !== 200 || publicGet.body.data.images.length !== 2) {
    context.blockers.push({
      actual: hashJson([publicGet.status, publicGet.body?.data?.images?.length ?? -1]),
      criterion: "manual_public_get",
      expected: hashJson([200, 2]),
    })
  }
  context.observations.push({
    bodySha256: hashJson(statuses),
    label: "manual_provider_qa",
    status: statuses.every((status) => [200, 201].includes(status)) ? 200 : 500,
  })
}
