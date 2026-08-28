import { expect, test } from "@playwright/test"

import {
  authenticatedServiceClient,
  captureTrustSafety,
  cleanupTrustSafetyFixture,
  createTrustSafetyFixture,
  login,
  logout,
  postJson,
  readReservationAdminOutcome,
  readTrustOutcome,
  suspendFixtureAdmin,
  type TrustSafetyFixture,
} from "./trust-safety-helpers"

test("reports, blocks, and admin moderation enforce safe boundaries", async ({
  page,
}, testInfo) => {
  let fixture: TrustSafetyFixture | null = null
  try {
    fixture = await createTrustSafetyFixture(testInfo)
    await login(page, fixture.learnerEmail, "/lessons")

    const malformed = await postJson(page, "/api/reports", {
      reason: "unsupported",
      targetId: fixture.lessonId,
      targetType: "message",
    })
    const foreign = await postJson(page, "/api/reports", {
      reason: "foreign",
      targetId: fixture.foreignId,
      targetType: "user",
    })
    const created = await postJson(page, "/api/reports", {
      detail: "표시 정보가 실제와 다릅니다.",
      reason: "허위 정보",
      targetId: fixture.lessonId,
      targetType: "lesson",
    })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const reportId = readCreatedReportId(created.body)
    const duplicate = await postJson(page, "/api/reports", {
      reason: "duplicate",
      targetId: fixture.lessonId,
      targetType: "lesson",
    })
    const selfBlock = await postJson(page, "/api/blocks", { blockedId: fixture.learnerId })
    const block = await postJson(page, "/api/blocks", { blockedId: fixture.coachId })
    const blockReplay = await postJson(page, "/api/blocks", {
      blockedId: fixture.coachId,
      reason: "ignored retry",
    })
    const blockedReservation = await postJson(page, "/api/reservations", {
      lessonId: fixture.lessonId,
      lessonScheduleId: fixture.scheduleId,
    })

    expect([
      malformed.status,
      foreign.status,
      created.status,
      duplicate.status,
      selfBlock.status,
      block.status,
      blockReplay.status,
      blockedReservation.status,
    ]).toEqual([422, 403, 201, 409, 422, 201, 200, 404])
    expect(blockReplay.body).toMatchObject({ data: { idempotent: true } })

    await logout(page)
    await login(page, fixture.adminEmail, "/admin/reports")
    await expect(page.getByRole("heading", { level: 1, name: "신고 검토" })).toBeVisible()
    await expect(page.getByRole("link", { name: /허위 정보/u })).toBeVisible()
    await captureTrustSafety(page, testInfo.project.name, "list")

    await page.getByRole("link", { name: /허위 정보/u }).click()
    await expect(page.getByRole("heading", { level: 1, name: "신고 상세 검토" })).toBeVisible()
    await captureTrustSafety(page, testInfo.project.name, "detail-submitted")
    const [startResponse] = await Promise.all([
      page.waitForResponse(`**/api/admin/reports/${reportId}/resolve`),
      page.waitForNavigation(),
      page.getByRole("button", { name: "검토 시작" }).click(),
    ])
    expect(startResponse.status()).toBe(200)

    await page.getByLabel("명시적 조치").selectOption("hide_lesson")
    await page.getByLabel("처리 메모").fill("정책 위반 확인")
    const [resolveResponse] = await Promise.all([
      page.waitForResponse(`**/api/admin/reports/${reportId}/resolve`),
      page.waitForNavigation(),
      page.getByRole("button", { name: "처리 완료" }).click(),
    ])
    expect(resolveResponse.status()).toBe(200)
    await expect(page.getByText("조치 완료", { exact: true }).first()).toBeVisible()
    await captureTrustSafety(page, testInfo.project.name, "detail-resolved")

    const exactReplay = await postJson(page, `/api/admin/reports/${reportId}/resolve`, {
      action: "resolve",
      moderationAction: "hide_lesson",
      resolutionNote: "정책 위반 확인",
    })
    const staleConflict = await postJson(page, `/api/admin/reports/${reportId}/resolve`, {
      action: "reject",
      moderationAction: "none",
      resolutionNote: "상충 결정",
    })
    expect([exactReplay.status, staleConflict.status]).toEqual([200, 409])
    expect(exactReplay.body).toMatchObject({ data: { idempotent: true } })

    const outcome = await readTrustOutcome(fixture, reportId)
    expect(outcome).toMatchObject({
      audit_count: 2,
      lesson_status: "paused",
      notification_count: 1,
      reservation_status: "confirmed",
    })

    await logout(page)
    await login(page, fixture.suspendedAdminEmail, "/admin/reports")
    await suspendFixtureAdmin(fixture)
    const denied = await postJson(page, `/api/admin/reports/${reportId}/resolve`, {
      action: "resolve",
      moderationAction: "hide_lesson",
      resolutionNote: "정책 위반 확인",
    })
    expect(denied.status).toBe(403)
  } finally {
    await cleanupTrustSafetyFixture(fixture)
  }
})

test("concurrent report resolution has one side-effect winner", async ({ page }, testInfo) => {
  let fixture: TrustSafetyFixture | null = null
  try {
    fixture = await createTrustSafetyFixture(testInfo)
    await login(page, fixture.learnerEmail, "/lessons")
    const created = await postJson(page, "/api/reports", {
      reason: "예약 분쟁",
      targetId: fixture.confirmedReservationId,
      targetType: "reservation",
    })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const reportId = readCreatedReportId(created.body)
    await logout(page)
    await login(page, fixture.adminEmail, `/admin/reports/${reportId}`)
    await postJson(page, `/api/admin/reports/${reportId}/resolve`, {
      action: "start_review",
      moderationAction: "none",
      resolutionNote: null,
    })

    const results = await page.evaluate(
      async ({ id }) => {
        const resolve = () =>
          fetch(`/api/admin/reports/${id}/resolve`, {
            body: JSON.stringify({
              action: "resolve",
              moderationAction: "none",
              resolutionNote: "동시 처리 검증",
            }),
            headers: { "content-type": "application/json" },
            method: "POST",
          }).then(async (response) => ({ body: await response.json(), status: response.status }))
        return Promise.all([resolve(), resolve()])
      },
      { id: reportId },
    )

    expect(results.map((result) => result.status)).toEqual([200, 200])
    expect(results.map((result) => result.body.data.idempotent).sort()).toEqual([false, true])
    const outcome = await readTrustOutcome(fixture, reportId)
    expect(outcome).toMatchObject({ audit_count: 2, notification_count: 1 })
  } finally {
    await cleanupTrustSafetyFixture(fixture)
  }
})

test("reservation admin operations use real HTTP/RPC boundaries and render responsively", async ({
  page,
}, testInfo) => {
  let fixture: TrustSafetyFixture | null = null
  try {
    fixture = await createTrustSafetyFixture(testInfo)
    await page.goto("/lessons")
    const anonymous = await postJson(
      page,
      `/api/admin/reservations/${fixture.confirmedReservationId}/status`,
      {
        action: "open_dispute",
        reason: "익명 요청",
      },
    )
    expect(anonymous.status).toBe(401)

    await login(page, fixture.learnerEmail, "/lessons")
    const learnerList = await page.evaluate(async () => {
      const response = await fetch("/api/admin/reservations")
      return { body: await response.json(), status: response.status }
    })
    const learnerStatus = await postJson(
      page,
      `/api/admin/reservations/${fixture.confirmedReservationId}/status`,
      {
        action: "open_dispute",
        reason: "학습자 요청",
      },
    )
    expect([learnerList.status, learnerStatus.status]).toEqual([403, 403])

    await logout(page)
    await login(page, fixture.coachEmail, "/lessons")
    const coachDetail = await page.evaluate(async (id) => {
      const response = await fetch(`/api/admin/reservations/${id}`)
      return { body: await response.json(), status: response.status }
    }, fixture.confirmedReservationId)
    expect(coachDetail.status).toBe(403)

    const malformed = await postJson(
      page,
      `/api/admin/reservations/${fixture.confirmedReservationId}/status`,
      {
        action: "not-approved",
        reason: "malformed",
      },
    )
    expect(malformed.status).toBe(422)
    await logout(page)

    await login(page, fixture.suspendedAdminEmail, "/admin/reservations")
    await suspendFixtureAdmin(fixture)
    const inactive = await page.evaluate(async () => {
      const response = await fetch("/api/admin/reservations")
      return response.status
    })
    expect(inactive).toBe(403)
    await logout(page)

    await login(page, fixture.adminEmail, "/admin/reservations")
    await page.goto("/admin/reservations?uiState=loading", { waitUntil: "commit" })
    const listLoading = page.getByText("예약 운영 목록을 불러오는 중입니다…", { exact: true })
    await expect(listLoading).toBeVisible()
    await expect(listLoading).toHaveAttribute("aria-live", "polite")
    await captureTrustSafety(page, testInfo.project.name, "reservations-list-loading")

    await page.goto("/admin/reservations?uiState=error")
    const listError = page.locator("main[role=alert]")
    await expect(listError).toBeVisible()
    const listErrorHeading = listError.locator("h1")
    await expect(listErrorHeading).toHaveText("예약 운영 목록을 불러오지 못했습니다")
    await expect(listErrorHeading).toBeFocused()
    await expect(listError.getByRole("button", { name: "다시 시도" })).toBeVisible()
    await captureTrustSafety(page, testInfo.project.name, "reservations-list-error")
    await listError.getByRole("button", { name: "다시 시도" }).click()
    await expect(listError).toBeVisible()

    const list = await page.evaluate(async () => {
      const response = await fetch("/api/admin/reservations")
      return { body: await response.json(), status: response.status }
    })
    const detail = await page.evaluate(async (id) => {
      const response = await fetch(`/api/admin/reservations/${id}`)
      return { body: await response.json(), status: response.status }
    }, fixture.confirmedReservationId)
    expect([list.status, detail.status]).toEqual([200, 200])

    await page.goto("/admin/reservations?status=pending_payment")
    await expect(page.getByText("조건에 맞는 예약이 없습니다")).toBeVisible()
    await captureTrustSafety(page, testInfo.project.name, "reservations-empty")
    await page.goto(`/admin/reservations/${fixture.confirmedReservationId}`)
    await expect(page.getByRole("heading", { level: 1, name: "신뢰 안전 검증 레슨" })).toBeVisible()
    await page.goto(`/admin/reservations/${fixture.confirmedReservationId}?uiState=loading`, {
      waitUntil: "commit",
    })
    const detailLoading = page.getByText("예약 운영 상세를 불러오는 중입니다…", { exact: true })
    await expect(detailLoading).toBeVisible()
    await expect(detailLoading).toHaveAttribute("aria-live", "polite")
    await captureTrustSafety(page, testInfo.project.name, "reservations-detail-loading")

    await page.goto(`/admin/reservations/${fixture.confirmedReservationId}?uiState=error`)
    const detailError = page.locator("main[role=alert]")
    await expect(detailError).toBeVisible()
    const detailErrorHeading = detailError.locator("h1")
    await expect(detailErrorHeading).toHaveText("예약 운영 상세를 불러오지 못했습니다")
    await expect(detailErrorHeading).toBeFocused()
    await expect(detailError.getByRole("button", { name: "다시 시도" })).toBeVisible()
    await captureTrustSafety(page, testInfo.project.name, "reservations-detail-error")
    await detailError.getByRole("button", { name: "다시 시도" }).click()
    await expect(detailError).toBeVisible()

    await page.goto(`/admin/reservations/${fixture.confirmedReservationId}`)
    await expect(page.getByRole("heading", { level: 1, name: "신뢰 안전 검증 레슨" })).toBeVisible()
    await captureTrustSafety(page, testInfo.project.name, "reservations-detail", [
      fixture.confirmedReservationId,
    ])

    const concurrent = await page.evaluate(async (id) => {
      const request = () =>
        fetch(`/api/admin/reservations/${id}/status`, {
          body: JSON.stringify({ action: "open_dispute", reason: "동시 분쟁 검증" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }).then(async (response) => ({ body: await response.json(), status: response.status }))
      return Promise.all([request(), request()])
    }, fixture.confirmedReservationId)
    expect(concurrent.map((result) => result.status).sort(), JSON.stringify(concurrent)).toEqual([
      200, 200,
    ])
    expect(concurrent.map((result) => result.body.data.idempotent).sort()).toEqual([false, true])
    expect(await readReservationAdminOutcome(fixture)).toMatchObject({
      audit_count: 1,
      notification_count: 0,
      reservation_status: "disputed",
    })

    const conflicting = await postJson(
      page,
      `/api/admin/reservations/${fixture.confirmedReservationId}/status`,
      { action: "open_dispute", reason: "충돌하는 분쟁 사유" },
    )
    expect(conflicting.status).toBe(409)

    await page.getByLabel("처리 사유").fill("동시 분쟁 검증")
    await page.getByRole("button", { name: "분쟁 시작" }).click()
    await expect(page.getByText(/상태가 disputed 처리되었습니다/u)).toBeVisible()
    await captureTrustSafety(page, testInfo.project.name, "reservations-success", [
      fixture.confirmedReservationId,
    ])

    const direct = await authenticatedServiceClient(fixture.learnerEmail)
    const bypass = await direct
      .from("reservations")
      .update({ status: "completed" })
      .eq("id", fixture.confirmedReservationId)
    expect(bypass.error).not.toBeNull()
  } finally {
    await cleanupTrustSafetyFixture(fixture)
  }
})

function readCreatedReportId(body: unknown) {
  if (!body || typeof body !== "object" || !("data" in body)) {
    throw new TypeError("Report response data is missing")
  }
  const data = body.data
  if (!data || typeof data !== "object" || !("id" in data) || typeof data.id !== "string") {
    throw new TypeError("Report response id is missing")
  }
  return data.id
}
