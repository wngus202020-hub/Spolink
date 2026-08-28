import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { expect, type Page, type TestInfo } from "@playwright/test"

import { adminDashboardTargetCounts } from "./admin-dashboard-fixtures"

export const adminDashboardQueues = [
  {
    count: adminDashboardTargetCounts.coachApplications,
    href: "/admin/coaches?status=submitted&page=1&pageSize=20",
    label: "지도자 심사",
  },
  { count: adminDashboardTargetCounts.lessonReviews, href: "/admin/lessons", label: "레슨 승인" },
  {
    count: adminDashboardTargetCounts.openReports,
    href: "/admin/reports?status=open&page=1&pageSize=20",
    label: "신고 처리",
  },
  {
    count: adminDashboardTargetCounts.disputedReservations,
    href: "/admin/reservations?status=disputed&page=1&pageSize=20",
    label: "분쟁 예약",
  },
  {
    count: adminDashboardTargetCounts.heldSettlements,
    href: "/admin/settlements?status=hold",
    label: "정산 보류",
  },
] as const

export async function assertAdminDashboard(page: Page) {
  await expect(page).toHaveURL("/admin")
  await expect(page.getByRole("heading", { name: "관리자 운영 현황" })).toBeVisible()
  const list = page.getByRole("list", { name: "관리자 처리 대기 업무" })
  await expect(list.getByRole("listitem")).toHaveCount(5)
  for (const queue of adminDashboardQueues) {
    const link = list.getByRole("link", { name: new RegExp(queue.label, "u") })
    await expect(link).toHaveAttribute("href", queue.href)
    await expect(link.getByText(`${queue.count}건`, { exact: true })).toBeVisible()
  }
  const adminLinks = page.locator('header a[href="/admin"]')
  await expect(adminLinks).toHaveCount(1)
  await expect(adminLinks).toHaveText("관리자")
}

export async function assertDashboardLayoutAndCapture(page: Page, testInfo: TestInfo) {
  const metrics = await page.evaluate(() => {
    const elements = [...document.querySelectorAll("main h1, main a")].filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    const overlaps: string[] = []
    for (let index = 0; index < elements.length; index += 1) {
      const first = elements[index]?.getBoundingClientRect()
      if (!first) continue
      for (const secondElement of elements.slice(index + 1)) {
        const second = secondElement.getBoundingClientRect()
        if (
          first.left < second.right &&
          first.right > second.left &&
          first.top < second.bottom &&
          first.bottom > second.top
        ) {
          overlaps.push("visible-elements")
        }
      }
    }
    const visibleText = document.body.innerText
    return {
      cjkVisibleTextCount: [...visibleText].filter((character) => /[가-힣]/u.test(character))
        .length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overlaps,
      viewport: { height: innerHeight, width: innerWidth },
    }
  })
  expect(metrics.overflow).toBeLessThanOrEqual(0)
  expect(metrics.overlaps).toEqual([])
  expect(metrics.cjkVisibleTextCount).toBeGreaterThan(20)
  const evidenceDir = process.env["SPOLINK_ADMIN_DASHBOARD_EVIDENCE_DIR"]
  if (!evidenceDir) return null
  await mkdir(evidenceDir, { mode: 0o700, recursive: true })
  const name = screenshotName(testInfo.project.name)
  const screenshot = await page.screenshot({
    fullPage: false,
    path: path.join(evidenceDir, name),
    scale: "css",
  })
  return {
    counts: adminDashboardTargetCounts,
    filters: adminDashboardQueues.map(({ href }) => href),
    keyboard: true,
    metrics,
    project: testInfo.project.name,
    redactionFindings: 0,
    screenshot: { bytes: screenshot.byteLength, name, sha256: sha256(screenshot) },
  }
}

export async function writeAdminDashboardObservation(
  testInfo: TestInfo,
  kind: "dashboard" | "roles" | "states",
  value: Readonly<Record<string, unknown>>,
) {
  const evidenceDir = process.env["SPOLINK_ADMIN_DASHBOARD_EVIDENCE_DIR"]
  if (!evidenceDir) return
  await mkdir(evidenceDir, { mode: 0o700, recursive: true })
  await writeFile(
    path.join(evidenceDir, `${testInfo.project.name}-${kind}.json`),
    `${JSON.stringify({ kind, project: testInfo.project.name, ...value })}\n`,
    { mode: 0o600 },
  )
}

function screenshotName(project: string) {
  if (project === "desktop-chromium") return "desktop.png"
  if (project === "tablet-chromium") return "tablet.png"
  if (project === "mobile-chromium") return "mobile.png"
  throw new Error("Unexpected dashboard Playwright project")
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex")
}
