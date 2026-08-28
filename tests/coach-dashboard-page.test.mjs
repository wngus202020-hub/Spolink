import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import typescript from "typescript"

const projectRootUrl = pathToFileURL(`${process.cwd()}/`)
const runtimeKey = Symbol.for("spolink.coach-dashboard-page-runtime")

const runtime = {
  calls: [],
  createElement,
  dashboard: null,
  focusCount: 0,
}

globalThis[runtimeKey] = runtime

const stubSources = new Map([
  [
    "next/link",
    `const runtime = globalThis[Symbol.for("spolink.coach-dashboard-page-runtime")]
export default function Link({ children, href, ...props }) {
  return runtime.createElement("a", { ...props, href }, children)
}`,
  ],
  ["@/components/layout/public-header", "export function PublicHeader() { return null }"],
  [
    "@/lib/lessons/coach-authoring-page",
    `const runtime = globalThis[Symbol.for("spolink.coach-dashboard-page-runtime")]
export async function readApprovedCoachPage(path) {
  runtime.calls.push(["auth", path])
  return {
    auth: { coachProfile: { id: "coach-owned" }, kind: "ready", profile: { id: "profile-owned" } },
    supabase: { kind: "rls-aware-client" },
  }
}`,
  ],
  [
    "@/lib/coach/dashboard-read-model",
    `const runtime = globalThis[Symbol.for("spolink.coach-dashboard-page-runtime")]
export async function readCoachDashboard(input) {
  runtime.calls.push(["read-model", input.coachProfileId, input.profileId, input.client.kind])
  return runtime.dashboard
}`,
  ],
])

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".ts") || url.endsWith(".tsx")) {
      const fileName = fileURLToPath(url)
      const fileSource = readFileSync(fileName, "utf8")
      const source = url.endsWith("/app/coach/dashboard/error.tsx")
        ? fileSource.replace(
            'import { useEffect, useRef } from "react"',
            `const runtime = globalThis[Symbol.for("spolink.coach-dashboard-page-runtime")]
const useEffect = (effect) => effect()
const useRef = () => ({ current: { focus() { runtime.focusCount += 1 } } })`,
          )
        : fileSource
      const result = typescript.transpileModule(source, {
        compilerOptions: {
          jsx: typescript.JsxEmit.ReactJSX,
          module: typescript.ModuleKind.ESNext,
          target: typescript.ScriptTarget.ES2022,
        },
        fileName,
      })
      return { format: "module", shortCircuit: true, source: result.outputText }
    }
    return nextLoad(url, context)
  },
  resolve(specifier, context, nextResolve) {
    const stubSource = stubSources.get(specifier)
    if (stubSource) {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(stubSource)}` }
    }

    const baseUrl = specifier.startsWith("@/")
      ? new URL(specifier.slice(2), projectRootUrl)
      : context.parentURL && specifier.startsWith(".")
        ? new URL(specifier, context.parentURL)
        : null
    if (baseUrl) {
      for (const extension of [".ts", ".tsx"]) {
        const candidate = new URL(`${baseUrl.href}${extension}`)
        if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

const populatedDashboard = Object.freeze({
  notifications: Object.freeze({
    items: Object.freeze([
      Object.freeze({
        body: "예약 일정이 변경되었습니다.",
        createdAt: "2026-08-29T03:30:00.000Z",
        rawPayload: "private-notification-payload",
        title: "일정 변경 알림",
      }),
    ]),
    unreadCount: 4,
  }),
  pendingSettlements: Object.freeze({ count: 2, totalNetAmount: 33000 }),
  recentReviews: Object.freeze([
    Object.freeze({
      author: "reviewer-private-name",
      content: "설명이 친절하고 수업 흐름이 좋았어요.",
      createdAt: "2026-08-28T23:00:00.000Z",
      lessonTitle: "테니스 입문 집중 클래스",
      rating: 5,
    }),
  ]),
  reservations: Object.freeze({
    completionPending: 3,
    confirmed: 3,
    labels: Object.freeze({ confirmed: "예약 확정", pending_payment: "결제 대기" }),
    pendingPayment: 2,
  }),
  todaySchedules: Object.freeze([
    Object.freeze({
      capacity: 6,
      endsAt: "2026-08-29T05:00:00.000Z",
      isOpen: true,
      lessonTitle: "주말 아침 테니스 초급자 기본기 집중 클래스",
      reservedCount: 4,
      startsAt: "2026-08-29T03:00:00.000Z",
    }),
    Object.freeze({
      capacity: 4,
      endsAt: "2026-08-29T08:00:00.000Z",
      isOpen: false,
      lessonTitle: "러닝 자세 교정",
      reservedCount: 4,
      startsAt: "2026-08-29T07:00:00.000Z",
    }),
  ]),
})

const emptyDashboard = Object.freeze({
  notifications: Object.freeze({ items: Object.freeze([]), unreadCount: 0 }),
  pendingSettlements: Object.freeze({ count: 0, totalNetAmount: 0 }),
  recentReviews: Object.freeze([]),
  reservations: Object.freeze({
    completionPending: 0,
    confirmed: 0,
    labels: Object.freeze({ confirmed: "예약 확정", pending_payment: "결제 대기" }),
    pendingPayment: 0,
  }),
  todaySchedules: Object.freeze([]),
})

test("dashboard populated HTML", async () => {
  const { default: CoachDashboardPage } = await loadRequiredModule("app/coach/dashboard/page.tsx")
  resetRuntime(populatedDashboard)

  const html = renderToStaticMarkup(await CoachDashboardPage({ searchParams: Promise.resolve({}) }))

  assert.deepEqual(runtime.calls, [
    ["auth", "/coach/dashboard"],
    ["read-model", "coach-owned", "profile-owned", "rls-aware-client"],
  ])
  for (const text of [
    "지도자 운영 센터",
    "승인 완료",
    "결제 대기",
    "2건",
    "예약 확정",
    "3건",
    "완료 처리 대기",
    "정산 예정",
    "33,000원",
    "오늘 일정",
    "12:00",
    "14:00",
    "테니스 입문 집중 클래스",
    "4 / 6명",
    "모집 중",
    "마감",
    "처리할 예약",
    "최근 리뷰",
    "읽지 않은 알림",
    "빠른 실행",
  ]) {
    assert.ok(html.includes(text), `missing visible text: ${text}`)
  }
  assert.deepEqual(readHrefs(html), [
    "/coach/reservations?status=pending_payment",
    "/coach/reservations?status=confirmed",
    "/coach/lessons/new",
    "/coach/lessons",
    "/coach/reservations",
    "/coach/settlements",
    "/coach/settlements",
  ])
  assert.doesNotMatch(html, /reviewer-private-name|private-notification-payload|author|rawPayload/u)
  assert.match(html, /sm:grid-cols-2/u)
  assert.match(html, /lg:grid-cols-4/u)
  assert.match(html, /min-w-0/u)
  assert.match(html, /break-words/u)

  console.log(
    `DASHBOARD_POPULATED_HTML ${JSON.stringify({
      dimensions: { desktop: 1280, mobile: 390, tablet: 768 },
      headings: readHeadings(html),
      htmlSha256: createHash("sha256").update(html).digest("hex"),
      links: readHrefs(html),
      textAssertions: { anonymous: true, noRawPayload: true, noReviewer: true },
    })}`,
  )
})

test("renders section-specific empty states without mutating input", async () => {
  const { default: CoachDashboardPage } = await loadRequiredModule("app/coach/dashboard/page.tsx")
  resetRuntime(emptyDashboard)
  const before = JSON.stringify(emptyDashboard)

  const html = renderToStaticMarkup(await CoachDashboardPage({ searchParams: Promise.resolve({}) }))

  for (const text of [
    "오늘 예정된 일정이 없습니다.",
    "처리할 예약이 없습니다.",
    "정산 예정 내역이 없습니다.",
    "아직 등록된 리뷰가 없습니다.",
    "읽지 않은 알림이 없습니다.",
  ]) {
    assert.ok(html.includes(text), `missing empty state: ${text}`)
  }
  assert.equal(JSON.stringify(emptyDashboard), before)
})

test("fixture uiState is exact, scalar, and environment-gated", async (t) => {
  const { default: CoachDashboardPage } = await loadRequiredModule("app/coach/dashboard/page.tsx")
  const previous = process.env["SPOLINK_COACH_DASHBOARD_UI_FIXTURES"]
  const scenarios = [
    [undefined, "error"],
    ["disabled", "loading"],
    ["enabled", ["error", "loading"]],
    ["enabled", "unexpected"],
  ]

  try {
    for (const [environment, uiState] of scenarios) {
      await t.test(`${environment ?? "missing"}-${String(uiState)}`, async () => {
        setFixtureEnvironment(environment)
        resetRuntime(emptyDashboard)
        const html = renderToStaticMarkup(
          await CoachDashboardPage({ searchParams: Promise.resolve({ uiState }) }),
        )
        assert.match(html, /지도자 운영 센터/u)
        assert.deepEqual(
          runtime.calls.map((call) => call[0]),
          ["auth", "read-model"],
        )
      })
    }

    setFixtureEnvironment("enabled")
    resetRuntime(emptyDashboard)
    await assert.rejects(
      CoachDashboardPage({ searchParams: Promise.resolve({ uiState: "error" }) }),
      /Deterministic coach dashboard error fixture/u,
    )
    assert.deepEqual(runtime.calls, [["auth", "/coach/dashboard"]])

    const originalSetTimeout = globalThis.setTimeout
    const delays = []
    globalThis.setTimeout = (callback, delay) => {
      delays.push(delay)
      callback()
      return 1
    }
    try {
      resetRuntime(emptyDashboard)
      const loadingResultHtml = renderToStaticMarkup(
        await CoachDashboardPage({ searchParams: Promise.resolve({ uiState: "loading" }) }),
      )
      assert.deepEqual(delays, [2_000])
      assert.match(loadingResultHtml, /지도자 운영 센터/u)
      assert.deepEqual(
        runtime.calls.map((call) => call[0]),
        ["auth", "read-model"],
      )
    } finally {
      globalThis.setTimeout = originalSetTimeout
    }
  } finally {
    setFixtureEnvironment(previous)
  }
})

test("loading and error states expose accessible operational recovery", async () => {
  const { default: CoachDashboardLoading } = await loadRequiredModule(
    "app/coach/dashboard/loading.tsx",
  )
  const { default: CoachDashboardError } = await loadRequiredModule("app/coach/dashboard/error.tsx")
  let resetCount = 0
  runtime.focusCount = 0

  const loadingHtml = renderToStaticMarkup(createElement(CoachDashboardLoading))
  const errorElement = CoachDashboardError({ reset: () => (resetCount += 1) })
  const errorHtml = renderToStaticMarkup(errorElement)
  findClickableElement(errorElement).props.onClick()

  assert.match(loadingHtml, /aria-busy="true"/u)
  assert.match(loadingHtml, /role="status"/u)
  assert.match(loadingHtml, /지도자 운영 현황을 불러오는 중입니다/u)
  assert.equal(runtime.focusCount, 1)
  assert.equal(resetCount, 1)
  assert.match(errorHtml, /role="alert"/u)
  assert.match(errorHtml, /tabindex="-1"/u)
  assert.match(errorHtml, /지도자 운영 현황을 불러오지 못했어요/u)
  assert.match(errorHtml, />다시 시도</u)
  assert.doesNotMatch(errorHtml, /database|query|supabase|stack|error:/iu)
})

async function loadRequiredModule(path) {
  assert.equal(existsSync(path), true, `RED: ${path} is not implemented`)
  return import(`../${path}`)
}

function resetRuntime(dashboard) {
  runtime.calls = []
  runtime.dashboard = dashboard
}

function setFixtureEnvironment(value) {
  if (value === undefined) delete process.env["SPOLINK_COACH_DASHBOARD_UI_FIXTURES"]
  else process.env["SPOLINK_COACH_DASHBOARD_UI_FIXTURES"] = value
}

function readHrefs(html) {
  return [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>/gu)].map((match) => match[1])
}

function readHeadings(html) {
  return [...html.matchAll(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gu)].map((match) =>
    match[1].replace(/<[^>]+>/gu, ""),
  )
}

function findClickableElement(node) {
  if (!node || typeof node !== "object") return null
  if (typeof node.props?.onClick === "function") return node
  const children = Array.isArray(node.props?.children)
    ? node.props.children
    : [node.props?.children]
  for (const child of children) {
    const found = findClickableElement(child)
    if (found) return found
  }
  return null
}
