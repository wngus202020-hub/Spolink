import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"

import { chromium } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import postgres from "postgres"
import {
  createQaUser,
  loginQaPage,
  writePrivateJson,
} from "./lesson-authoring-browser-qa-support.mjs"
import { readGuardedLocalStatus } from "./supabase-e2e/local-status.mjs"
import { startNextServer } from "./supabase-e2e/next-server.mjs"

const evidenceDir = ".omo/evidence/high-priority-missing-services/task-2/runtime/browser"
const password = "LocalOnly-Authoring-42!"
const interruptionMode = process.env.LESSON_AUTHORING_QA_INTERRUPT === "after-draft"

await mkdir(evidenceDir, { recursive: true, mode: 0o700 })
const status = await readGuardedLocalStatus()
const service = createClient(status.apiUrl, status.serviceRoleKey, {
  auth: { persistSession: false },
})
const sql = postgres(status.dbUrl, { max: 1 })
const runId = randomUUID()
const coachEmail = `lesson-coach-${runId}@example.test`
const adminEmail = `lesson-admin-${runId}@example.test`
const learnerEmail = `lesson-learner-${runId}@example.test`
const userIds = []
let lessonId = null
let scheduleId = null
let server = null
let browser = null

try {
  const [coachId, adminId, learnerId] = await Promise.all([
    createQaUser(service, coachEmail, password),
    createQaUser(service, adminEmail, password),
    createQaUser(service, learnerEmail, password),
  ])
  userIds.push(coachId, adminId, learnerId)
  const coachProfileId = randomUUID()
  const [sport] =
    await sql`select id from public.sports where is_active order by created_at limit 1`
  assert.equal(typeof sport?.id, "string")
  await sql`
    insert into public.profiles (id, display_name, role, status) values
      (${coachId}, '브라우저 QA 지도자', 'learner', 'coach_approved'),
      (${adminId}, '브라우저 QA 관리자', 'admin', 'active'),
      (${learnerId}, '브라우저 QA 학습자', 'learner', 'active')
  `
  await sql`
    insert into public.coach_profiles (id, user_id, status, service_region)
    values (${coachProfileId}, ${coachId}, 'approved', '서울 강남구')
  `

  server = await startNextServer({ mode: "configured", status })
  browser = await chromium.launch({ headless: true })
  const coachContext = await browser.newContext({
    baseURL: server.baseUrl,
    viewport: { width: 1280, height: 900 },
  })
  const coachPage = await coachContext.newPage()
  await loginQaPage(coachPage, coachEmail, password, "/coach/lessons/new")
  await coachPage.getByLabel("레슨 제목").fill("브라우저 검증 테니스 레슨")
  await coachPage.getByLabel("종목").selectOption(String(sport.id))
  await coachPage.getByLabel("한 줄 요약").fill("안전한 입문 랠리 수업")
  await coachPage
    .getByLabel("상세 설명")
    .fill("초보자가 안전하게 기본 자세와 랠리를 익히는 수업입니다.")
  await coachPage.getByLabel("지역").fill("서울 강남구")
  await coachPage.getByLabel("장소명").fill("SPOLINK 코트")
  await coachPage.getByLabel("수업 시간(분)").fill("60")
  await coachPage.getByLabel("가격(원)").fill("50000")
  await coachPage.getByLabel("기본 정원").fill("4")
  const createResponsePromise = coachPage.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/lessons",
  )
  await coachPage.getByRole("button", { name: "임시 저장" }).click()
  const createResponse = await createResponsePromise
  console.log(
    JSON.stringify({
      createLessonStatus: createResponse.status(),
    }),
  )
  await coachPage.waitForURL(/\/coach\/lessons\/[0-9a-f-]+\/edit$/u)
  lessonId = new URL(coachPage.url()).pathname.split("/").at(-2) ?? null
  assert.ok(lessonId)
  assert.equal((await coachPage.request.get(`/api/lessons/${lessonId}`)).status(), 404)
  await coachPage.screenshot({
    fullPage: true,
    path: `${evidenceDir}/coach-lesson-draft-desktop.png`,
  })
  if (interruptionMode) {
    throw new Error("INJECTED_QA_INTERRUPTION")
  }

  await coachPage.goto(`/coach/lessons/${lessonId}/schedules`)
  const scheduleForm = coachPage.locator("form").filter({ hasText: "새 일정" })
  await scheduleForm.getByLabel("시작").fill("2026-08-20T10:00")
  await scheduleForm.getByLabel("종료").fill("2026-08-20T11:00")
  await scheduleForm.getByLabel("정원").fill("4")
  await scheduleForm.getByRole("button", { name: "일정 추가" }).click()
  await coachPage.getByText("일정을 추가했습니다.", { exact: true }).waitFor()
  ;[scheduleId] = (
    await sql`select id from public.lesson_schedules where lesson_id = ${lessonId}`
  ).map((row) => String(row.id))
  assert.ok(scheduleId)

  const malformed = await coachPage.request.post("/api/lessons", {
    data: "{broken",
    headers: { "content-type": "application/json", origin: server.baseUrl },
  })
  assert.equal(malformed.status(), 422)
  const crossOrigin = await coachPage.request.post("/api/lessons", {
    data: {},
    headers: { "content-type": "application/json", origin: "https://attacker.invalid" },
  })
  assert.equal(crossOrigin.status(), 403)

  await coachPage.goto(`/coach/lessons/${lessonId}/edit`)
  await coachPage.getByRole("button", { name: "검토 요청" }).click()
  await coachPage.waitForURL(/\/coach\/lessons$/u)
  const pending = await sql`select status, updated_at from public.lessons where id = ${lessonId}`
  assert.equal(pending[0]?.status, "pending_review")
  const replay = await coachPage.request.post(`/api/lessons/${lessonId}/status`, {
    data: { action: "submit", expectedUpdatedAt: pending[0]?.updated_at, reason: null },
    headers: { origin: server.baseUrl },
  })
  assert.equal(replay.status(), 409)

  const adminContext = await browser.newContext({
    baseURL: server.baseUrl,
    viewport: { width: 1280, height: 900 },
  })
  const adminPage = await adminContext.newPage()
  await loginQaPage(adminPage, adminEmail, password, "/admin/lessons")
  await adminPage.getByRole("heading", { name: "브라우저 검증 테니스 레슨" }).waitFor()
  await adminPage.screenshot({
    fullPage: true,
    path: `${evidenceDir}/admin-lesson-review-desktop.png`,
  })
  await adminPage.getByRole("button", { name: "승인" }).click()
  await adminPage.getByText("검토 대기 레슨이 없습니다", { exact: true }).waitFor()
  assert.equal((await adminPage.request.get(`/api/lessons/${lessonId}`)).status(), 200)

  const raceCreate = await coachPage.request.post(`/api/lessons/${lessonId}/schedules`, {
    data: {
      capacity: 4,
      endsAt: "2026-08-21T02:00:00.000Z",
      startsAt: "2026-08-21T01:00:00.000Z",
    },
    headers: { origin: server.baseUrl },
  })
  assert.equal(raceCreate.status(), 201)
  const raceSchedule = (await raceCreate.json()).data
  const concurrentCreateUpdateResponses = await Promise.all([
    coachPage.request.patch(`/api/lessons/${lessonId}/schedules/${raceSchedule.id}`, {
      data: {
        capacity: 5,
        endsAt: "2026-08-21T04:00:00.000Z",
        expectedUpdatedAt: raceSchedule.updatedAt,
        startsAt: "2026-08-21T03:00:00.000Z",
      },
      headers: { origin: server.baseUrl },
    }),
    coachPage.request.post(`/api/lessons/${lessonId}/schedules`, {
      data: {
        capacity: 4,
        endsAt: "2026-08-21T04:30:00.000Z",
        startsAt: "2026-08-21T03:30:00.000Z",
      },
      headers: { origin: server.baseUrl },
    }),
  ])
  const concurrentCreateUpdateStatuses = concurrentCreateUpdateResponses
    .map((response) => response.status())
    .sort()
  assert.equal(concurrentCreateUpdateStatuses.filter((status) => status === 409).length, 1)
  assert.equal(
    concurrentCreateUpdateStatuses.some((status) => status === 200 || status === 201),
    true,
  )
  const raceResponses = await Promise.all([
    coachPage.request.post(`/api/lessons/${lessonId}/schedules/${raceSchedule.id}/close`, {
      data: { expectedUpdatedAt: raceSchedule.updatedAt },
      headers: { origin: server.baseUrl },
    }),
    coachPage.request.patch(`/api/lessons/${lessonId}/schedules/${raceSchedule.id}`, {
      data: {
        capacity: 5,
        endsAt: raceSchedule.endsAt,
        expectedUpdatedAt: raceSchedule.updatedAt,
        startsAt: raceSchedule.startsAt,
      },
      headers: { origin: server.baseUrl },
    }),
  ])
  const concurrencyStatuses = raceResponses.map((response) => response.status()).sort()
  assert.deepEqual(concurrencyStatuses, [200, 409])

  await sql`
    insert into public.reservations (
      lesson_id, lesson_schedule_id, learner_id, coach_profile_id,
      status, reserved_price_amount
    ) values (${lessonId}, ${scheduleId}, ${learnerId}, ${coachProfileId}, 'confirmed', 50000)
  `
  const [storedSchedule] = await sql`
    select starts_at, ends_at, updated_at from public.lesson_schedules where id = ${scheduleId}
  `
  const protectedMutation = await coachPage.request.patch(
    `/api/lessons/${lessonId}/schedules/${scheduleId}`,
    {
      data: {
        capacity: 3,
        endsAt: storedSchedule?.ends_at,
        expectedUpdatedAt: storedSchedule?.updated_at,
        startsAt: storedSchedule?.starts_at,
      },
      headers: { origin: server.baseUrl },
    },
  )
  assert.equal(protectedMutation.status(), 409)

  await coachPage.setViewportSize({ width: 390, height: 844 })
  await coachPage.goto(`/coach/lessons/${lessonId}/edit`)
  await coachPage.getByRole("heading", { name: "레슨 상세·수정" }).waitFor()
  await coachPage.screenshot({
    fullPage: true,
    path: `${evidenceDir}/coach-lesson-active-mobile.png`,
  })
  assert.equal(await coachPage.evaluate(() => document.documentElement.scrollWidth <= 390), true)
  await Promise.all([coachContext.close(), adminContext.close()])

  await writePrivateJson(`${evidenceDir}/browser-qa.json`, {
    adminApprovedActive: true,
    confirmedScheduleMutationStatus: protectedMutation.status(),
    concurrencyStatuses,
    concurrentCreateUpdateStatuses,
    crossOriginStatus: crossOrigin.status(),
    draftPublicStatus: 404,
    malformedInputStatus: malformed.status(),
    mobileHorizontalOverflow: false,
    replayStatus: replay.status(),
    screenshots: [
      `${evidenceDir}/coach-lesson-draft-desktop.png`,
      `${evidenceDir}/admin-lesson-review-desktop.png`,
      `${evidenceDir}/coach-lesson-active-mobile.png`,
    ],
  })
} finally {
  if (browser) await browser.close()
  if (lessonId) {
    await sql`delete from public.reservations where lesson_id = ${lessonId}`
    await sql`delete from public.lesson_schedules where lesson_id = ${lessonId}`
    await sql`delete from public.lessons where id = ${lessonId}`
  }
  for (const userId of userIds) {
    await sql`delete from public.coach_profiles where user_id = ${userId}`
    await sql`delete from public.profiles where id = ${userId}`
    await service.auth.admin.deleteUser(userId)
  }
  if (server) await server.stop()
  if (interruptionMode) {
    const [remaining] = await sql`
      select
        (select count(*)::integer from auth.users
          where email in (${coachEmail}, ${adminEmail}, ${learnerEmail})) as auth_count,
        (select count(*)::integer from public.lessons
          where id = ${lessonId}) as lesson_count
    `
    await writeFile(
      `${evidenceDir}/interruption-cleanup.json`,
      `${JSON.stringify(
        {
          fixtureAuthRowsRemaining: remaining?.auth_count ?? -1,
          fixtureLessonRowsRemaining: remaining?.lesson_count ?? -1,
          injectedAt: "after-draft",
          nextServerStopped: true,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    )
  }
  await sql.end()
}
