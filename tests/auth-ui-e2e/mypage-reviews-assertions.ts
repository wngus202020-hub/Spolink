import { expect, type Page } from "@playwright/test"
import { type createLiveAuthSession, toPlaywrightSupabaseCookies } from "./auth-recovery-helpers"
import { fixtureManifest, hiddenReason, inactiveLessonTitle } from "./mypage-reviews-fixtures"

export type ReviewSession = Awaited<ReturnType<typeof createLiveAuthSession>>

export async function activateReviewSession(page: Page, session: ReviewSession): Promise<void> {
  await page.context().clearCookies()
  await page
    .context()
    .addCookies(toPlaywrightSupabaseCookies(new URL(requireBaseUrl()).origin, session.cookies))
}

export async function createOwnerAReviews(
  page: Page,
  session: ReviewSession,
  createPath: string,
): Promise<readonly string[]> {
  const ids: string[] = []
  for (const [index, reservationId] of fixtureManifest.reservations.ownerA.entries()) {
    ids.push(
      await createReview(
        page,
        session,
        createPath,
        reservationId,
        `A 리뷰 ${String(index + 1).padStart(2, "0")}`,
      ),
    )
  }
  return ids
}

export async function createReview(
  page: Page,
  session: ReviewSession,
  createPath: string,
  reservationId: string,
  content: string,
): Promise<string> {
  await activateReviewSession(page, session)
  const response = await page.request.post(createPath, {
    data: { content, rating: 5, reservationId },
    headers: { Origin: requireBaseUrl() },
  })
  expect(response.status()).toBe(201)
  const id = readNestedString(await response.json(), "data", "id")
  if (!id) throw new Error("Create review response omitted id.")
  return id
}

export async function hideReview(
  page: Page,
  admin: ReviewSession,
  hidePath: string,
): Promise<void> {
  await activateReviewSession(page, admin)
  const response = await page.request.post(hidePath, {
    data: { reason: hiddenReason },
    headers: { Origin: requireBaseUrl() },
  })
  expect(response.status()).toBe(200)
}

export async function assertOwnerAHistory(page: Page, session: ReviewSession): Promise<void> {
  await activateReviewSession(page, session)
  await page.goto("/mypage/reviews")
  const history = page.getByRole("region", { name: "리뷰 내역" })
  await expect(history.getByRole("listitem")).toHaveCount(20)
  await expect(history.getByText("A 리뷰 21", { exact: true })).toBeVisible()
  await expect(history.getByText("A 리뷰 02", { exact: true })).toBeVisible()
  await expect(history.getByText("A 리뷰 01", { exact: true })).toHaveCount(0)
  await expect(history.getByText("B 리뷰 01", { exact: true })).toHaveCount(0)
  await expect(history.getByText("삭제 음성 fixture", { exact: true })).toHaveCount(0)
  await expect(history.getByText(hiddenReason, { exact: true })).toBeVisible()
  await expect(history.getByText(inactiveLessonTitle, { exact: true })).toBeVisible()
  await expect(history.getByRole("link", { name: inactiveLessonTitle })).toHaveCount(0)
  await history.getByRole("link", { name: "다음" }).click()
  await expect(page).toHaveURL(/\/mypage\/reviews\?page=2$/u)
  await expect(history.getByRole("listitem")).toHaveCount(1)
  await expect(history.getByText("A 리뷰 01", { exact: true })).toBeVisible()
}

export async function assertOwnerBIsolation(page: Page, session: ReviewSession): Promise<void> {
  await activateReviewSession(page, session)
  await page.goto("/mypage/reviews")
  await expect(page.getByText("B 리뷰 01", { exact: true })).toBeVisible()
  await expect(page.getByText(/A 리뷰/u)).toHaveCount(0)
  await expect(page.getByText(hiddenReason, { exact: true })).toHaveCount(0)
}

export async function assertPublicIsolation(
  page: Page,
  session: ReviewSession,
  ownerAIds: readonly string[],
  ownerBId: string,
  publicPath: string,
): Promise<void> {
  await activateReviewSession(page, session)
  const response = await page.request.get(publicPath)
  expect(response.status()).toBe(200)
  const rows = readDataRows(await response.json())
  expect(rows).toHaveLength(20)
  const ids = rows.map((row) => row["id"])
  expect(ids).toContain(ownerBId)
  expect(ids).not.toContain(ownerAIds[19])
  expect(ids).not.toContain(fixtureManifest.negativeReview)
  expect(rows.every((row) => !("hiddenReason" in row) && !("hidden_reason" in row))).toBe(true)
}

export async function assertOutOfRangeRecovery(page: Page, session: ReviewSession): Promise<void> {
  await activateReviewSession(page, session)
  await page.goto("/mypage/reviews?page=999")
  await expect(
    page.getByRole("heading", { name: "리뷰 목록 페이지를 다시 선택해요" }),
  ).toBeVisible()
  await page.getByRole("link", { name: "첫 페이지 보기" }).click()
  await expect(page).toHaveURL(/\/mypage\/reviews$/u)
  await expect(page.getByText("A 리뷰 21", { exact: true })).toBeVisible()
}

export async function assertAnonymousRedirect(page: Page): Promise<void> {
  await page.context().clearCookies()
  await page.goto("/mypage/reviews")
  await expect(page).toHaveURL(`${requireBaseUrl()}/auth/login?next=/mypage/reviews`)
}

function requireBaseUrl(): string {
  const value = process.env["SPOLINK_AUTH_E2E_BASE_URL"]
  if (!value) throw new Error("SPOLINK_AUTH_E2E_BASE_URL is required.")
  return value
}

function readNestedString(value: unknown, parent: string, key: string): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const nested = Object.fromEntries(Object.entries(value))[parent]
  if (typeof nested !== "object" || nested === null || Array.isArray(nested)) return null
  const result = Object.fromEntries(Object.entries(nested))[key]
  return typeof result === "string" ? result : null
}

function readDataRows(value: unknown): readonly Record<string, unknown>[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return []
  const data = Object.fromEntries(Object.entries(value))["data"]
  if (!Array.isArray(data)) return []
  return data.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null && !Array.isArray(row),
  )
}
