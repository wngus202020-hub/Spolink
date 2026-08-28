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
const runtimeKey = Symbol.for("spolink.admin-dashboard-state-runtime")

class RedirectSignal extends Error {
  constructor(destination) {
    super(`redirect:${destination}`)
    this.destination = destination
  }
}

const runtime = {
  auth: null,
  calls: [],
  client: null,
  createElement,
  focusCount: 0,
  redirect(destination) {
    throw new RedirectSignal(destination)
  },
}

globalThis[runtimeKey] = runtime

const stubSources = new Map([
  [
    "next/navigation",
    `const runtime = globalThis[Symbol.for("spolink.admin-dashboard-state-runtime")]
export const redirect = (destination) => runtime.redirect(destination)`,
  ],
  [
    "next/link",
    `const runtime = globalThis[Symbol.for("spolink.admin-dashboard-state-runtime")]
export default function Link({ children, href, ...props }) {
  return runtime.createElement("a", { ...props, href }, children)
}`,
  ],
  ["@/components/layout/public-header", "export function PublicHeader() { return null }"],
  [
    "@/lib/auth/page-auth",
    `const runtime = globalThis[Symbol.for("spolink.admin-dashboard-state-runtime")]
export async function readPageAuthProfile() {
  runtime.calls.push("auth")
  if (runtime.auth.kind === "account_suspended") {
    runtime.redirect("/auth/restricted?reason=account-suspended")
  }
  if (runtime.auth.kind === "account_deleted") {
    runtime.redirect("/auth/restricted?reason=account-deleted")
  }
  return runtime.auth
}`,
  ],
  [
    "@/lib/auth/server-profile",
    `const runtime = globalThis[Symbol.for("spolink.admin-dashboard-state-runtime")]
export async function createSupabaseServerComponentClient() {
  runtime.calls.push("client")
  return runtime.client
}`,
  ],
])

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".ts") || url.endsWith(".tsx")) {
      const fileName = fileURLToPath(url)
      const fileSource = readFileSync(fileName, "utf8")
      const source = url.endsWith("/app/admin/error.tsx")
        ? fileSource.replace(
            'import { useEffect, useRef } from "react"',
            `const runtime = globalThis[Symbol.for("spolink.admin-dashboard-state-runtime")]
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

test("baseline pins dashboard auth/render and reservation fault-state precedent", () => {
  const page = readFileSync("app/admin/page.tsx", "utf8")
  const reservationPage = readFileSync("app/admin/reservations/page.tsx", "utf8")
  const reservationLoading = readFileSync("app/admin/reservations/loading.tsx", "utf8")
  const reservationError = readFileSync("app/admin/reservations/error.tsx", "utf8")

  assert.ok(
    page.indexOf("const auth = await readPageAuthProfile()") <
      page.indexOf("const counts = await readAdminDashboardCounts"),
  )
  assert.match(page, /queues\.map/u)
  assert.match(reservationPage, /SPOLINK_AUTH_E2E_ADMIN_RESERVATION_STATE/u)
  assert.match(reservationPage, /forceUiState && resolvedSearchParams\.uiState === "loading"/u)
  assert.match(reservationPage, /forceUiState && resolvedSearchParams\.uiState === "error"/u)
  assert.match(reservationLoading, /aria-live="polite"/u)
  assert.match(reservationError, /headingRef\.current\?\.focus\(\)/u)
  assert.match(reservationError, /role="alert"/u)
  assert.match(reservationError, /<Button onClick=\{reset\}>/u)
})

test("renders five dimension-stable loading tiles with a polite announcement", async () => {
  const { default: AdminDashboardLoading } = await loadRequiredModule("app/admin/loading.tsx")

  const html = renderToStaticMarkup(createElement(AdminDashboardLoading))

  assert.match(html, /aria-live="polite"/u)
  assert.match(html, /관리자 운영 현황을 불러오는 중입니다/u)
  assert.equal((html.match(/<li/gu) ?? []).length, 5)
  assert.equal((html.match(/min-h-44/gu) ?? []).length, 5)
  assert.doesNotMatch(html, /role="progressbar"|<svg|spinner/iu)
  printManualObservation("loading-markup", {
    htmlSha256: sha256(html),
    politeAnnouncement: true,
    stablePlaceholders: 5,
  })
})

test("focuses the safe Korean error alert and invokes reset", async () => {
  const { default: AdminDashboardError } = await loadRequiredModule("app/admin/error.tsx")
  const { default: AdminDashboardPage } = await loadRequiredModule("app/admin/page.tsx")
  let resetCount = 0
  runtime.focusCount = 0

  const element = AdminDashboardError({ reset: () => (resetCount += 1) })
  const html = renderToStaticMarkup(element)
  const retryButton = findNativeElement(element, "button")
  retryButton.props.onClick()
  resetPageRuntime()
  const retriedHtml = renderToStaticMarkup(
    await AdminDashboardPage({ searchParams: Promise.resolve({}) }),
  )

  assert.equal(runtime.focusCount, 1)
  assert.equal(resetCount, 1)
  assert.equal((retriedHtml.match(/<a/gu) ?? []).length, 5)
  assert.match(html, /<main[^>]*role="alert"/u)
  assert.match(html, /<h1[^>]*tabindex="-1"[^>]*>관리자 운영 현황을 불러오지 못했습니다<\/h1>/u)
  assert.match(html, />다시 시도<\/button>/u)
  assert.doesNotMatch(html, /database|query|supabase|PRIVATE|stack|error:/iu)
  printManualObservation("error-focus-reset", {
    focusCount: runtime.focusCount,
    htmlSha256: sha256(html),
    resetCount,
    retriedHtmlSha256: sha256(retriedHtml),
    retriedTiles: 5,
    safeAlert: true,
  })
})

test("ignores query-only, malformed, duplicate, and leaked-environment fault attempts", async (t) => {
  const { default: AdminDashboardPage } = await loadRequiredModule("app/admin/page.tsx")
  const previous = process.env["SPOLINK_AUTH_E2E_ADMIN_DASHBOARD_STATE"]
  const scenarios = [
    [undefined, "error"],
    ["disabled", "error"],
    ["Enabled", "loading"],
    ["enabled ", "error"],
    ["enabled", "unexpected"],
    ["enabled", ["error", "loading"]],
  ]
  const observations = []

  try {
    for (const [environment, uiState] of scenarios) {
      await t.test(`${environment ?? "missing"}-${String(uiState)}`, async () => {
        setStateEnvironment(environment)
        resetPageRuntime()
        const html = renderToStaticMarkup(
          await AdminDashboardPage({ searchParams: Promise.resolve({ uiState }) }),
        )
        assert.deepEqual(runtime.calls, ["auth", "client", "counts"])
        assert.match(html, /관리자 운영 현황/u)
        observations.push({ environment: environment ?? "missing", uiState, calls: runtime.calls })
      })
    }
  } finally {
    setStateEnvironment(previous)
  }
  printManualObservation("fail-closed-inputs", { observations })
})

test("decodes encoded uiState values before applying the exact environment gate", async () => {
  const { default: AdminDashboardPage } = await loadRequiredModule("app/admin/page.tsx")
  const previousEnvironment = process.env["SPOLINK_AUTH_E2E_ADMIN_DASHBOARD_STATE"]
  const originalSetTimeout = globalThis.setTimeout
  let releaseLoading

  try {
    setStateEnvironment(undefined)
    for (const encodedQuery of ["uiState=%6Co%61ding", "uiState=%65rr%6Fr"]) {
      resetPageRuntime()
      const html = renderToStaticMarkup(
        await AdminDashboardPage({
          searchParams: Promise.resolve(decodeSearchParams(encodedQuery)),
        }),
      )
      assert.deepEqual(runtime.calls, ["auth", "client", "counts"])
      assert.match(html, /관리자 운영 현황/u)
    }

    setStateEnvironment("enabled")
    globalThis.setTimeout = (callback, delay) => {
      assert.equal(delay, 2_000)
      releaseLoading = callback
      return 0
    }
    resetPageRuntime()
    const loadingRender = AdminDashboardPage({
      searchParams: Promise.resolve(decodeSearchParams("uiState=%6Co%61ding")),
    })
    await Promise.resolve()
    await Promise.resolve()
    assert.deepEqual(runtime.calls, ["auth"])
    assert.equal(typeof releaseLoading, "function")
    releaseLoading()
    await loadingRender
    assert.deepEqual(runtime.calls, ["auth", "client", "counts"])

    resetPageRuntime()
    await assert.rejects(
      AdminDashboardPage({
        searchParams: Promise.resolve(decodeSearchParams("uiState=%65rr%6Fr")),
      }),
      /Injected admin dashboard failure/u,
    )
    assert.deepEqual(runtime.calls, ["auth"])

    for (const encodedQuery of [
      "uiState=%65rror%00",
      "uiState=%6Co%61ding%2Bextra",
      "uiState=%E0%A4%A",
      "uiState=%65rr%6Fr&uiState=%6Co%61ding",
    ]) {
      resetPageRuntime()
      const html = renderToStaticMarkup(
        await AdminDashboardPage({
          searchParams: Promise.resolve(decodeSearchParams(encodedQuery)),
        }),
      )
      assert.deepEqual(runtime.calls, ["auth", "client", "counts"])
      assert.match(html, /관리자 운영 현황/u)
    }
    printManualObservation("encoded-ui-state", {
      decodedExactOnly: true,
      encodedMalformedIgnored: 4,
      encodedValid: ["loading", "error"],
    })
  } finally {
    globalThis.setTimeout = originalSetTimeout
    setStateEnvironment(previousEnvironment)
  }
})

test("redirects every denied auth classification before both exact-env fault states", async (t) => {
  const { default: AdminDashboardPage } = await loadRequiredModule("app/admin/page.tsx")
  const previousEnvironment = process.env["SPOLINK_AUTH_E2E_ADMIN_DASHBOARD_STATE"]
  const originalSetTimeout = globalThis.setTimeout
  const accountScenarios = [
    ["unauthenticated", { kind: "unauthenticated" }, "/auth/login?next=/admin"],
    ["unconfigured", { kind: "unconfigured" }, "/auth/login?next=/admin"],
    ["profile_required", { kind: "profile_required" }, "/onboarding/profile"],
    [
      "account_suspended",
      { kind: "account_suspended" },
      "/auth/restricted?reason=account-suspended",
    ],
    ["account_deleted", { kind: "account_deleted" }, "/auth/restricted?reason=account-deleted"],
  ]
  const readyScenarios = ["admin", "coach", "learner"].flatMap((role) =>
    ["active", "coach_approved", "pending_coach"].flatMap((status) =>
      role === "admin" && status === "active"
        ? []
        : [[`ready-${role}-${status}`, readyAuth(role, status), "/mypage"]],
    ),
  )
  const observations = []
  let delayCalls = 0

  try {
    setStateEnvironment("enabled")
    globalThis.setTimeout = () => {
      delayCalls += 1
      return 0
    }
    for (const [classification, auth, destination] of [...accountScenarios, ...readyScenarios]) {
      for (const uiState of ["loading", "error"]) {
        await t.test(`${classification}-${uiState}`, async () => {
          resetPageRuntime()
          runtime.auth = auth
          delayCalls = 0
          await assert.rejects(
            AdminDashboardPage({ searchParams: Promise.resolve({ uiState }) }),
            (error) => error instanceof RedirectSignal && error.destination === destination,
          )
          assert.deepEqual(runtime.calls, ["auth"])
          assert.equal(delayCalls, 0)
          observations.push({
            classification,
            destination,
            uiState,
            calls: [...runtime.calls],
            delayCalls,
          })
        })
      }
    }
    assert.equal(observations.length, 26)
    printManualObservation("denied-auth-fault-matrix", { observations })
  } finally {
    globalThis.setTimeout = originalSetTimeout
    setStateEnvironment(previousEnvironment)
  }
})

test("applies exact env-gated loading and error only after active-admin auth", async () => {
  const { default: AdminDashboardPage } = await loadRequiredModule("app/admin/page.tsx")
  const previousEnvironment = process.env["SPOLINK_AUTH_E2E_ADMIN_DASHBOARD_STATE"]
  const originalSetTimeout = globalThis.setTimeout
  let releaseLoading

  try {
    process.env["SPOLINK_AUTH_E2E_ADMIN_DASHBOARD_STATE"] = "enabled"
    resetPageRuntime()
    globalThis.setTimeout = (callback, delay) => {
      assert.equal(delay, 2_000)
      releaseLoading = callback
      return 0
    }
    const loadingRender = AdminDashboardPage({
      searchParams: Promise.resolve({ uiState: "loading" }),
    })
    await Promise.resolve()
    await Promise.resolve()
    assert.deepEqual(runtime.calls, ["auth"])
    assert.equal(typeof releaseLoading, "function")
    releaseLoading()
    await loadingRender
    assert.deepEqual(runtime.calls, ["auth", "client", "counts"])
    const loadingCalls = [...runtime.calls]

    resetPageRuntime()
    await assert.rejects(
      AdminDashboardPage({ searchParams: Promise.resolve({ uiState: "error" }) }),
      /Injected admin dashboard failure/u,
    )
    assert.deepEqual(runtime.calls, ["auth"])
    const errorCalls = [...runtime.calls]

    runtime.auth = readyAuth("learner", "active")
    runtime.calls = []
    await assert.rejects(
      AdminDashboardPage({ searchParams: Promise.resolve({ uiState: "error" }) }),
      (error) => error instanceof RedirectSignal && error.destination === "/mypage",
    )
    assert.deepEqual(runtime.calls, ["auth"])
    printManualObservation("auth-before-fault", {
      deniedCalls: [...runtime.calls],
      errorCalls,
      loadingCalls,
    })
  } finally {
    globalThis.setTimeout = originalSetTimeout
    setStateEnvironment(previousEnvironment)
  }
})

test("propagates every count failure to one safe whole-page error with no tiles", async () => {
  const { default: AdminDashboardError } = await loadRequiredModule("app/admin/error.tsx")
  const { default: AdminDashboardPage } = await loadRequiredModule("app/admin/page.tsx")
  const { AdminDashboardReadError } = await import("../lib/admin/dashboard-read-model.ts")
  const queueLabels = ["지도자 심사", "레슨 승인", "신고 처리", "분쟁 예약", "정산 보류"]
  const failedQueries = ["coach_profiles", "lessons", "reports", "reservations", "settlements"]
  const observations = []

  for (const failedQuery of failedQueries) {
    resetPageRuntime()
    runtime.client = createDashboardClient({ failedTable: failedQuery, failure: "error" })
    await assert.rejects(
      AdminDashboardPage({ searchParams: Promise.resolve({}) }),
      AdminDashboardReadError,
    )
    assert.deepEqual(runtime.calls, ["auth", "client", "counts"])

    const html = renderToStaticMarkup(AdminDashboardError({ reset() {} }))
    for (const label of queueLabels) assert.doesNotMatch(html, new RegExp(label, "u"))
    assert.doesNotMatch(html, new RegExp(failedQuery, "u"))
    assert.doesNotMatch(html, /PRIVATE|query detail/u)
    observations.push({ failedQuery, htmlSha256: sha256(html), tileLabels: 0 })
  }
  printManualObservation("whole-page-count-failures", { observations })
})

test("drives every null count through the page and identical safe error boundary", async () => {
  const { default: AdminDashboardError } = await loadRequiredModule("app/admin/error.tsx")
  const { default: AdminDashboardPage } = await loadRequiredModule("app/admin/page.tsx")
  const { AdminDashboardReadError } = await import("../lib/admin/dashboard-read-model.ts")
  const queueLabels = ["지도자 심사", "레슨 승인", "신고 처리", "분쟁 예약", "정산 보류"]
  const failedQueries = ["coach_profiles", "lessons", "reports", "reservations", "settlements"]
  const observations = []
  let expectedHtml

  for (const failedQuery of failedQueries) {
    resetPageRuntime()
    runtime.client = createDashboardClient({ failedTable: failedQuery, failure: "null-count" })
    await assert.rejects(
      AdminDashboardPage({ searchParams: Promise.resolve({}) }),
      AdminDashboardReadError,
    )
    assert.deepEqual(runtime.calls, ["auth", "client", "counts"])

    const html = renderToStaticMarkup(AdminDashboardError({ reset() {} }))
    expectedHtml ??= html
    assert.equal(html, expectedHtml)
    for (const label of queueLabels) assert.doesNotMatch(html, new RegExp(label, "u"))
    assert.doesNotMatch(html, /\d+건|PRIVATE|database|query|supabase|stack|error:/iu)
    assert.doesNotMatch(html, new RegExp(failedQuery, "u"))
    observations.push({ failedQuery, htmlSha256: sha256(html), partialCounts: 0, tileLabels: 0 })
  }
  printManualObservation("whole-page-null-count-failures", { observations })
})

function printManualObservation(scenario, observable) {
  if (process.env["SPOLINK_ADMIN_DASHBOARD_STATE_MANUAL_QA"] !== "enabled") return
  console.log(`MANUAL_QA ${JSON.stringify({ observable, scenario })}`)
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function decodeSearchParams(encodedQuery) {
  const values = new URLSearchParams(encodedQuery).getAll("uiState")
  if (values.length === 0) return {}
  return { uiState: values.length === 1 ? values[0] : values }
}

function createDashboardClient(failure = null) {
  const counts = new Map([
    ["coach_profiles", 1],
    ["lessons", 2],
    ["reports", 3],
    ["reservations", 4],
    ["settlements", 5],
  ])

  return {
    from(table) {
      if (!runtime.calls.includes("counts")) runtime.calls.push("counts")
      const count = counts.get(table)
      assert.notEqual(count, undefined, `unknown dashboard table ${table}`)
      const result =
        failure?.failedTable === table
          ? failure.failure === "error"
            ? { count: null, error: { code: "PRIVATE_CODE", message: "private query detail" } }
            : { count: null, error: null }
          : { count, error: null }
      return {
        select() {
          return {
            eq() {
              return Promise.resolve(result)
            },
            in() {
              return Promise.resolve(result)
            },
          }
        },
      }
    },
  }
}

function findNativeElement(node, type) {
  assert.ok(node && typeof node === "object", `missing ${type} element`)
  if (node.type === type) return node
  if (typeof node.type === "function") return findNativeElement(node.type(node.props), type)
  const children = Array.isArray(node.props?.children)
    ? node.props.children
    : [node.props?.children]
  for (const child of children) {
    if (!child || typeof child !== "object") continue
    try {
      return findNativeElement(child, type)
    } catch (error) {
      if (!(error instanceof assert.AssertionError)) throw error
    }
  }
  assert.fail(`missing ${type} element`)
}

async function loadRequiredModule(path) {
  assert.equal(existsSync(path), true, `RED: ${path} is not implemented`)
  return import(`../${path}`)
}

function readyAuth(role, status) {
  return { coachProfile: null, kind: "ready", profile: { role, status } }
}

function resetPageRuntime() {
  runtime.auth = readyAuth("admin", "active")
  runtime.calls = []
  runtime.client = createDashboardClient()
}

function setStateEnvironment(value) {
  if (value === undefined) delete process.env["SPOLINK_AUTH_E2E_ADMIN_DASHBOARD_STATE"]
  else process.env["SPOLINK_AUTH_E2E_ADMIN_DASHBOARD_STATE"] = value
}
