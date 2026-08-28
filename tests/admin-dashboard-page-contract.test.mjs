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
const runtimeKey = Symbol.for("spolink.admin-dashboard-page-runtime")

class RedirectSignal extends Error {
  constructor(destination) {
    super(`redirect:${destination}`)
    this.destination = destination
  }
}

const runtime = {
  auth: null,
  calls: [],
  counts: null,
  createElement,
  redirect(destination) {
    throw new RedirectSignal(destination)
  },
}

globalThis[runtimeKey] = runtime

const stubSources = new Map([
  [
    "next/navigation",
    `const runtime = globalThis[Symbol.for("spolink.admin-dashboard-page-runtime")]
export const redirect = (destination) => runtime.redirect(destination)`,
  ],
  [
    "next/link",
    `const runtime = globalThis[Symbol.for("spolink.admin-dashboard-page-runtime")]
export default function Link({ children, href, ...props }) {
  return runtime.createElement("a", { ...props, href }, children)
}`,
  ],
  ["@/components/layout/public-header", "export function PublicHeader() { return null }"],
  [
    "@/lib/auth/page-auth",
    `const runtime = globalThis[Symbol.for("spolink.admin-dashboard-page-runtime")]
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
    `const runtime = globalThis[Symbol.for("spolink.admin-dashboard-page-runtime")]
export async function createSupabaseServerComponentClient() {
  runtime.calls.push("client")
  return { kind: "cookie-aware-test-client" }
}`,
  ],
  [
    "@/lib/admin/dashboard-read-model",
    `const runtime = globalThis[Symbol.for("spolink.admin-dashboard-page-runtime")]
export async function readAdminDashboardCounts(client) {
  runtime.calls.push("counts")
  if (client.kind !== "cookie-aware-test-client") throw new Error("wrong client")
  return runtime.counts
}`,
  ],
])

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".ts") || url.endsWith(".tsx")) {
      const fileName = fileURLToPath(url)
      const source = readFileSync(fileName, "utf8")
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

const destinations = [
  "/admin/coaches?status=submitted&page=1&pageSize=20",
  "/admin/lessons",
  "/admin/reports?status=open&page=1&pageSize=20",
  "/admin/reservations?status=disputed&page=1&pageSize=20",
  "/admin/settlements?status=hold",
]
const labels = ["지도자 심사", "레슨 승인", "신고 처리", "분쟁 예약", "정산 보류"]
const actions = [
  "심사 목록 보기",
  "승인 목록 보기",
  "신고 목록 보기",
  "분쟁 목록 보기",
  "보류 목록 보기",
]

test("baseline pins the existing restricted boundary and admin operational conventions", () => {
  const pageAuth = readFileSync("lib/auth/page-auth.ts", "utf8")
  const coachPage = readFileSync("app/admin/coaches/page.tsx", "utf8")
  const reservationPage = readFileSync("app/admin/reservations/page.tsx", "utf8")

  assert.match(pageAuth, /account_suspended[\s\S]*account-suspended/u)
  assert.match(pageAuth, /account_deleted[\s\S]*account-deleted/u)
  assert.match(coachPage, /profile\.role !== "admin" \|\| auth\.profile\.status !== "active"/u)
  assert.match(reservationPage, /export const dynamic = "force-dynamic"/u)
  assert.match(reservationPage, /export const fetchCache = "force-no-store"/u)
  for (const token of ["border-line", "bg-canvas", "text-primary", "text-secondary"]) {
    assert.match(`${coachPage}\n${reservationPage}`, new RegExp(token, "u"))
  }
})

test("declares a required Next PageProps argument", () => {
  const page = readFileSync("app/admin/page.tsx", "utf8")

  assert.match(
    page,
    /export default async function AdminDashboardPage\(\{ searchParams \}: Props\) \{/u,
  )
})

test("redirects every denied account before creating a client or reading counts", async (t) => {
  const { default: AdminDashboardPage } = await loadDashboardModule()
  const accountScenarios = [
    [{ kind: "unauthenticated" }, "/auth/login?next=/admin"],
    [{ kind: "unconfigured" }, "/auth/login?next=/admin"],
    [{ kind: "profile_required" }, "/onboarding/profile"],
    [{ kind: "account_suspended" }, "/auth/restricted?reason=account-suspended"],
    [{ kind: "account_deleted" }, "/auth/restricted?reason=account-deleted"],
  ]
  const readyScenarios = ["admin", "coach", "learner"].flatMap((role) =>
    ["active", "coach_approved", "pending_coach"].flatMap((status) =>
      role === "admin" && status === "active" ? [] : [[readyAuth(role, status), "/mypage"]],
    ),
  )
  const observations = []

  for (const [auth, destination] of [...accountScenarios, ...readyScenarios]) {
    await t.test(`${auth.kind}-${auth.profile?.role ?? "account"}`, async () => {
      resetRuntime(auth, counts(1, 2, 3, 4, 5))
      await assert.rejects(AdminDashboardPage({}), redirectTo(destination))
      assert.deepEqual(runtime.calls, ["auth"])
      observations.push({ calls: [...runtime.calls], destination, kind: auth.kind })
    })
  }
  maybePrintManualRedirectObservation(observations)
})

test("renders exactly five count links for an active administrator", async () => {
  const { default: AdminDashboardPage } = await loadDashboardModule()
  resetRuntime(readyAuth("admin", "active"), counts(1, 2, 3, 4, 5))

  const html = renderToStaticMarkup(await AdminDashboardPage({}))
  const links = readLinks(html)

  assert.deepEqual(runtime.calls, ["auth", "client", "counts"])
  assert.equal(links.length, 5)
  assert.deepEqual(
    links.map(({ href }) => href),
    destinations,
  )
  assert.deepEqual(
    links.map(({ text }) => labels.find((label) => text.includes(label))),
    labels,
  )
  assert.deepEqual(
    links.map(({ text }) => actions.find((action) => text.includes(action))),
    actions,
  )
  assert.deepEqual(
    links.map(({ text }) => text.match(/\d+건/u)?.[0]),
    ["1건", "2건", "3건", "4건", "5건"],
  )
  assert.match(html, /<h1[^>]*>관리자 운영 현황<\/h1>/u)
  assert.equal((html.match(/<svg/gu) ?? []).length, 10)
  maybePrintManualObservation("counts-1-to-5", html, links)
})

test("keeps all five zero-count queues clickable", async () => {
  const { default: AdminDashboardPage } = await loadDashboardModule()
  resetRuntime(readyAuth("admin", "active"), counts(0, 0, 0, 0, 0))

  const html = renderToStaticMarkup(await AdminDashboardPage({}))
  const links = readLinks(html)

  assert.equal(links.length, 5)
  assert.deepEqual(
    links.map(({ href }) => href),
    destinations,
  )
  assert.equal(
    links.every(({ text }) => text.includes("0건")),
    true,
  )
  maybePrintManualObservation("counts-zero", html, links)
})

test("stays server-only, count-only, compact, and free of dashboard API or previews", () => {
  const page = readFileSync("app/admin/page.tsx", "utf8")
  const tile = readFileSync("components/admin/admin-dashboard-tile.tsx", "utf8")
  const combined = `${page}\n${tile}`

  assert.match(page, /export const dynamic = "force-dynamic"/u)
  assert.match(page, /export const fetchCache = "force-no-store"/u)
  assert.match(page, /export const revalidate = 0/u)
  assert.doesNotMatch(combined, /["']use client["']/u)
  assert.doesNotMatch(combined, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/iu)
  assert.doesNotMatch(
    combined,
    /display_name|real_name|phone|email|reason|amount|certificate|provider|preview/iu,
  )
  assert.doesNotMatch(combined, /<form|<button|fetch\(|setInterval|useEffect|useState/u)
  assert.equal(existsSync("app/api/admin/dashboard"), false)
  assert.equal(page.split("\n").length <= 250, true)
  assert.equal(tile.split("\n").length <= 250, true)
})

function counts(
  coachApplications,
  lessonReviews,
  openReports,
  disputedReservations,
  heldSettlements,
) {
  return {
    coachApplications,
    disputedReservations,
    heldSettlements,
    lessonReviews,
    openReports,
  }
}

async function loadDashboardModule() {
  assert.equal(existsSync("app/admin/page.tsx"), true, "RED: app/admin/page.tsx is not implemented")
  return import("../app/admin/page.tsx")
}

function maybePrintManualObservation(scenario, html, links) {
  if (process.env["SPOLINK_ADMIN_DASHBOARD_MANUAL_QA"] !== "enabled") return
  console.log(
    `MANUAL_QA ${JSON.stringify({
      htmlSha256: createHash("sha256").update(html).digest("hex"),
      links,
      scenario,
    })}`,
  )
}

function maybePrintManualRedirectObservation(observations) {
  if (process.env["SPOLINK_ADMIN_DASHBOARD_MANUAL_QA"] !== "enabled") return
  const output = JSON.stringify(observations)
  console.log(
    `MANUAL_QA ${JSON.stringify({
      observations,
      outputSha256: createHash("sha256").update(output).digest("hex"),
      scenario: "denied-auth-before-data",
    })}`,
  )
}

function readLinks(html) {
  return [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gu)].map(
    ([, href, contents]) => ({
      href: href.replaceAll("&amp;", "&"),
      text: contents
        .replace(/<[^>]+>/gu, " ")
        .replace(/\s+/gu, " ")
        .trim(),
    }),
  )
}

function readyAuth(role, status) {
  return { coachProfile: null, kind: "ready", profile: { role, status } }
}

function redirectTo(destination) {
  return (error) => error instanceof RedirectSignal && error.destination === destination
}

function resetRuntime(auth, dashboardCounts) {
  runtime.auth = auth
  runtime.calls = []
  runtime.counts = dashboardCounts
}
