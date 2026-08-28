import assert from "node:assert/strict"

import { loginQaPage } from "../../lesson-authoring-browser-qa-support.mjs"
import { baseUrl } from "./constants.mjs"
import { assertFocusedAlert, readFocusState } from "./focus.mjs"
import { filePayload, readImageFixtures } from "./image-fixtures.mjs"
import { captureAuthoringState, hideNextDevelopmentPortal } from "./visual-capture.mjs"

export async function runDraftRecoveryScenario(harness) {
  const { fixture, page, requestSequence, viewportReceipts } = harness
  await loginQaPage(
    page,
    fixture.credentials.email,
    fixture.credentials.password,
    "/coach/lessons/new",
  )
  await fillLesson(page, harness.sportId)
  const imageBuffers = await readImageFixtures()
  await page
    .getByLabel("레슨 이미지 추가")
    .setInputFiles([
      filePayload("첫번째.webp", imageBuffers[0]),
      filePayload("두번째.webp", imageBuffers[1]),
      filePayload("세번째.webp", imageBuffers[2]),
      filePayload("네번째.webp", imageBuffers[3]),
      filePayload("다섯번째.webp", imageBuffers[4]),
    ])
  assert.equal(await page.getByText("업로드 대기", { exact: true }).count(), 5)
  await captureAuthoringState({
    evidenceDir: fixture.evidenceDir,
    page,
    receipts: viewportReceipts,
    state: "selection",
  })
  await page.getByRole("button", { name: "임시 저장" }).click()
  await page
    .getByText("레슨 초안은 저장되었습니다. 이미지 업로드를 완료하지 못했습니다.", {
      exact: true,
    })
    .waitFor()
  assert.equal(new URL(page.url()).pathname, "/coach/lessons/new")
  assert.deepEqual(requestSequence, [
    "create",
    "intent",
    "upload",
    "register",
    "intent",
    "upload",
    "register",
  ])
  assert.equal(await page.getByText("등록됨", { exact: true }).count(), 1)
  assert.equal(await page.getByText("업로드 실패", { exact: true }).count(), 1)
  assert.equal(await page.getByText("업로드 대기", { exact: true }).count(), 3)
  const recoveryAlert = page.locator('[role="alert"]:focus')
  await recoveryAlert.waitFor()
  const alertFocusState = await readFocusState(recoveryAlert)
  assertFocusedAlert(alertFocusState, "partial upload recovery alert")
  await page.getByText(/다시 시도하면 새 업로드로 시작합니다\./u, { exact: false }).waitFor()
  assert.equal(await page.getByRole("button", { name: "이미지만 다시 시도" }).count(), 1)
  await captureFailureEvidence(harness, alertFocusState)

  const [createdLesson] = await fixture.sql`
    select id, updated_at from public.lessons where coach_profile_id = ${fixture.coachProfileId}
  `
  const lessonId = createdLesson?.id ?? null
  assert.equal(typeof lessonId, "string")
  fixture.setLessonId(lessonId)
  const compensationState = await readCompensationState(fixture, lessonId)
  assert.deepEqual(compensationState.intentStatuses, ["registered", "cancelled"])
  assert.equal(compensationState.storageObjectCount, 1)
  const submitRace = await page.request.post(`/api/lessons/${lessonId}/status`, {
    data: { action: "submit", expectedUpdatedAt: createdLesson.updated_at, reason: null },
    headers: { origin: baseUrl },
  })
  assert.equal(submitRace.status(), 409)

  await page.getByRole("button", { name: "이미지만 다시 시도" }).click()
  await page.waitForURL(new RegExp(`/coach/lessons/${lessonId}/edit$`, "u"))
  assertRequestSequence(requestSequence)
  await assertRegisteredImages(fixture, lessonId)
  const [lessonBeforeEditImageActions] =
    await fixture.sql`select updated_at from public.lessons where id = ${lessonId}`
  return {
    alertFocusState,
    compensationState,
    imageBuffers,
    lessonBeforeEditImageActions,
    submitRaceStatus: submitRace.status(),
  }
}

async function captureFailureEvidence(harness, alertFocusState) {
  await captureAuthoringState({
    evidenceDir: harness.fixture.evidenceDir,
    page: harness.page,
    receipts: harness.viewportReceipts,
    state: "failure-retry",
  })
  await hideNextDevelopmentPortal(harness.page)
  await harness.page.screenshot({
    fullPage: true,
    path: `${harness.fixture.evidenceDir}/task-7-focus-error-desktop.png`,
  })
  await harness.page.screenshot({
    fullPage: true,
    path: `${harness.fixture.evidenceDir}/task-7-partial-failure.png`,
  })
  assert.match(
    alertFocusState.text,
    /레슨 초안은 저장되었습니다\. 이미지 업로드를 완료하지 못했습니다\./u,
  )
}

function assertRequestSequence(sequence) {
  assert.equal(sequence.filter((item) => item === "create").length, 1)
  assert.equal(sequence.filter((item) => item === "intent").length, 6)
  assert.equal(sequence.filter((item) => item === "upload").length, 6)
  assert.equal(sequence.filter((item) => item === "register").length, 6)
}

async function readCompensationState(fixture, lessonId) {
  const intents = await fixture.sql`
    select status from public.lesson_image_upload_intents
    where lesson_id = ${lessonId} order by created_at, id
  `
  const [storage] = await fixture.sql`
    select count(*)::integer as object_count from storage.objects
    where bucket_id = 'lesson-images' and name like ${`${lessonId}/%`}
  `
  return {
    intentStatuses: intents.map((row) => row.status),
    storageObjectCount: storage?.object_count ?? -1,
  }
}

async function assertRegisteredImages(fixture, lessonId) {
  const registered = await fixture.sql`
    select lifecycle_state, sort_order from public.lesson_images
    where lesson_id = ${lessonId} order by sort_order, id
  `
  assert.deepEqual(
    registered.map((row) => [row.lifecycle_state, row.sort_order]),
    [
      ["ready", 0],
      ["ready", 1],
      ["ready", 2],
      ["ready", 3],
      ["ready", 4],
    ],
  )
}

async function fillLesson(page, sportId) {
  await page.getByLabel("레슨 제목").fill("Todo7 이미지 레슨")
  await page.getByLabel("종목").selectOption(sportId)
  await page
    .getByLabel("상세 설명")
    .fill("이미지 업로드 수명주기를 검증하는 충분히 자세한 설명입니다.")
  await page.getByLabel("지역").fill("서울 강남구")
  await page.getByLabel("수업 시간(분)").fill("60")
  await page.getByLabel("가격(원)").fill("50000")
  await page.getByLabel("기본 정원").fill("4")
}
