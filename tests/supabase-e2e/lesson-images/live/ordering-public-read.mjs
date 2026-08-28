import { createHash } from "node:crypto"

import { publicObjectUrl, requestJson, statusObservation } from "../http-client.mjs"
import { createTinyPng } from "../image-fixtures.mjs"
import { expectStatus, hashJson, recordMutation } from "./assertions.mjs"
import { MIME_FIXTURES } from "./image-cases.mjs"
import { activateLesson, reorderImages, uploadAndRegister } from "./operations.mjs"
import { runBlockedLessonRace } from "./serialization-races.mjs"

export async function orderingAndPublicRead(context) {
  const lessonId = await context.database.createLesson(context.provision, { withSchedule: true })
  for (const [mimeType, createBytes] of MIME_FIXTURES) {
    const result = await uploadAndRegister(context, lessonId, createBytes(), mimeType)
    expectStatus(context, `public_seed_${mimeType}`, result.registration, 201)
  }
  const before = await context.database.readImages(lessonId)
  const expected = before.map((row) => row.id)
  const orders = [
    [expected[2], expected[0], expected[1]],
    [expected[1], expected[2], expected[0]],
  ]
  const reorderRace = await runBlockedLessonRace(context, {
    first: () => reorderImages(context, lessonId, "coach", expected, orders[0]),
    firstFunction: "reorder_lesson_images",
    label: "reorder_cas_race",
    lessonId,
    second: () => reorderImages(context, lessonId, "coach", expected, orders[1]),
    secondFunction: "reorder_lesson_images",
  })
  const reorderResults = reorderRace.results
  for (const [index, result] of reorderResults.entries()) {
    recordMutation(context, `reorder_race_${index + 1}`, result)
  }
  if (
    reorderResults.filter((result) => result.status === 200).length !== 1 ||
    reorderResults.filter((result) => result.status === 409).length !== 1
  ) {
    context.blockers.push({
      actual: hashJson(reorderResults.map((result) => result.status).sort()),
      criterion: "reorder_cas_race",
      expected: hashJson([200, 409]),
    })
  }
  const ordered = await context.database.readImages(lessonId)
  await activateLesson(context, lessonId)
  const list = await requestJson(context.next.baseUrl, "/api/lessons?pageSize=50", {
    contentType: null,
    method: "GET",
    origin: false,
  })
  const detail = await requestJson(context.next.baseUrl, `/api/lessons/${lessonId}`, {
    contentType: null,
    method: "GET",
    origin: false,
  })
  context.observations.push(statusObservation("public_list", list))
  context.observations.push(statusObservation("public_detail", detail))
  if (list.status !== 200 || detail.status !== 200) {
    context.blockers.push({
      actual: hashJson([list.status, detail.status]),
      criterion: "public_list_detail_status",
      expected: hashJson([200, 200]),
    })
    return
  }
  const listItem = list.body.data.find((item) => item.id === lessonId)
  const detailImages = detail.body.data.images
  if (!listItem?.thumbnailUrl?.endsWith(ordered[0].file_path)) {
    context.blockers.push({
      actual: "cover_mismatch",
      criterion: "public_list_cover_after_reorder",
      expected: "ordered_first_image",
    })
  }
  if (
    detailImages.length !== ordered.length ||
    detailImages.some((image, index) => !image.url.endsWith(ordered[index].file_path))
  ) {
    context.blockers.push({
      actual: hashJson(detailImages.map((image) => image.sortOrder)),
      criterion: "public_detail_order",
      expected: hashJson([0, 1, 2]),
    })
  }

  const objectGet = await fetch(publicObjectUrl(context.proxiedStatus.apiUrl, ordered[0].file_path))
  const objectBytes = Buffer.from(await objectGet.arrayBuffer())
  context.observations.push({
    bodySha256: createHash("sha256").update(objectBytes).digest("hex"),
    contentType: objectGet.headers.get("content-type"),
    label: "anonymous_active_ready_storage_get",
    status: objectGet.status,
  })
  if (
    objectGet.status !== 200 ||
    objectBytes.length === 0 ||
    !objectGet.headers.get("content-type")?.startsWith("image/")
  ) {
    context.blockers.push({
      actual: hashJson({
        bytes: objectBytes.length,
        contentType: objectGet.headers.get("content-type"),
        status: objectGet.status,
      }),
      criterion: "anonymous_active_ready_storage_get",
      expected: "200_nonempty_image",
    })
  }

  await context.database.setImageLifecycle(ordered[0].id, "deleting")
  const deletingList = await requestJson(context.next.baseUrl, "/api/lessons?pageSize=50", {
    contentType: null,
    method: "GET",
    origin: false,
  })
  const deletingDetail = await requestJson(context.next.baseUrl, `/api/lessons/${lessonId}`, {
    contentType: null,
    method: "GET",
    origin: false,
  })
  context.observations.push(statusObservation("public_deleting_list", deletingList))
  context.observations.push(statusObservation("public_deleting_detail", deletingDetail))
  const deletingListItem = deletingList.body?.data?.find((item) => item.id === lessonId)
  const deletingDetailImages = deletingDetail.body?.data?.images ?? []
  if (
    deletingList.status !== 200 ||
    deletingDetail.status !== 200 ||
    deletingListItem?.thumbnailUrl?.endsWith(ordered[0].file_path) ||
    deletingDetailImages.some((image) => image.url.endsWith(ordered[0].file_path))
  ) {
    context.blockers.push({
      actual: hashJson({
        detailCount: deletingDetailImages.length,
        detailStatus: deletingDetail.status,
        leakedCover: deletingListItem?.thumbnailUrl?.endsWith(ordered[0].file_path) ?? false,
        listStatus: deletingList.status,
      }),
      criterion: "public_deleting_nonready_exclusion",
      expected: "active_public_response_excludes_deleting_image",
    })
  }

  const hiddenLesson = await context.database.createLesson(context.provision, {
    withSchedule: true,
  })
  const hidden = await uploadAndRegister(context, hiddenLesson, createTinyPng(), "image/png")
  expectStatus(context, "hidden_draft_register", hidden.registration, 201)
  const hiddenDetail = await requestJson(context.next.baseUrl, `/api/lessons/${hiddenLesson}`, {
    contentType: null,
    method: "GET",
    origin: false,
  })
  if (hiddenDetail.status !== 404) {
    context.blockers.push({
      actual: hiddenDetail.status,
      criterion: "public_draft_ready_exclusion",
      expected: 404,
    })
  }
}
