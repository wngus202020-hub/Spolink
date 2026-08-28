import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import typescript from "typescript"

const projectRootUrl = pathToFileURL(`${process.cwd()}/`)
const runtimeKey = Symbol.for("spolink.admin-settlement-filter-runtime")

class RedirectSignal extends Error {
  constructor(destination) {
    super(`redirect:${destination}`)
    this.destination = destination
  }
}

const runtime = {
  auth: null,
  directRows: [],
  listError: null,
  listRows: [],
  listStatuses: [],
  settlements: [],
  createElement,
  redirect(destination) {
    throw new RedirectSignal(destination)
  },
}

globalThis[runtimeKey] = runtime

const stubSources = new Map([
  [
    "next/navigation",
    `const runtime = globalThis[Symbol.for("spolink.admin-settlement-filter-runtime")]
export const redirect = (destination) => runtime.redirect(destination)`,
  ],
  [
    "next/link",
    `const runtime = globalThis[Symbol.for("spolink.admin-settlement-filter-runtime")]
export default function Link({ children, href, ...props }) {
  return runtime.createElement("a", { ...props, href }, children)
}`,
  ],
  ["@/components/layout/public-header", "export function PublicHeader() { return null }"],
  [
    "@/components/money/settlement-list",
    `const runtime = globalThis[Symbol.for("spolink.admin-settlement-filter-runtime")]
export function SettlementList({ settlements }) {
  runtime.settlements = settlements
  return runtime.createElement("settlement-list", { "data-count": settlements.length })
}`,
  ],
  [
    "@/lib/auth/page-auth",
    `const runtime = globalThis[Symbol.for("spolink.admin-settlement-filter-runtime")]
export const readPageAuthProfile = async () => runtime.auth`,
  ],
  [
    "@/lib/auth/server-profile",
    `const runtime = globalThis[Symbol.for("spolink.admin-settlement-filter-runtime")]
export const createSupabaseServerComponentClient = async () => ({
  from() {
    return {
      select() {
        return {
          order() {
            return { data: runtime.directRows, error: null }
          },
        }
      },
    }
  },
})`,
  ],
  [
    "@/lib/money/read-model",
    `const runtime = globalThis[Symbol.for("spolink.admin-settlement-filter-runtime")]
export async function listSettlements(_client, status) {
  runtime.listStatuses.push(status)
  return { data: runtime.listRows, error: runtime.listError }
}
export function parseSettlementFilterStatus(value) {
  return ["pending", "hold", "approved", "all"].includes(value) ? value : value === undefined ? "all" : null
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
    if (stubSource)
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(stubSource)}` }

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

const { default: AdminSettlementsPage } = await import("../app/admin/settlements/page.tsx")
const { listSettlements, parseSettlementFilterStatus } = await import("../lib/money/read-model.ts")

const activeAdmin = { kind: "ready", profile: { role: "admin", status: "active" } }
const rows = [
  { id: "pending-row", status: "pending" },
  { id: "hold-row", status: "hold" },
  { id: "approved-row", status: "approved" },
]

function resetRuntime() {
  runtime.auth = activeAdmin
  runtime.directRows = rows
  runtime.listError = null
  runtime.listRows = rows
  runtime.listStatuses = []
  runtime.settlements = []
}

async function renderPage(searchParams) {
  const element = await AdminSettlementsPage({ searchParams: Promise.resolve(searchParams) })
  return renderToStaticMarkup(element)
}

async function captureRedirect(action) {
  try {
    await action()
  } catch (error) {
    if (error instanceof RedirectSignal) return error.destination
    throw error
  }
  return null
}

test("Given the settlement reader, when pending hold and approved are requested, then each applies one exact predicate", async () => {
  for (const status of ["pending", "hold", "approved"]) {
    const calls = []
    const query = {
      eq(column, value) {
        calls.push({ column, value })
        return this
      },
      order() {
        return this
      },
    }
    await listSettlements({ from: () => ({ select: () => query }) }, status)
    assert.deepEqual(calls, [{ column: "status", value: status }])
  }
})

test("Given a settlement status query value, when it is absent or malformed, then only the four allowed values are parsed", () => {
  assert.equal(parseSettlementFilterStatus(undefined), "all")
  assert.equal(parseSettlementFilterStatus(null), "all")
  assert.equal(parseSettlementFilterStatus("pending"), "pending")
  assert.equal(parseSettlementFilterStatus("hold"), "hold")
  assert.equal(parseSettlementFilterStatus("approved"), "approved")
  assert.equal(parseSettlementFilterStatus("all"), "all")
  assert.equal(parseSettlementFilterStatus("paid"), null)
  assert.equal(parseSettlementFilterStatus("failed"), null)
  assert.equal(parseSettlementFilterStatus(["hold", "approved"]), null)
})

test("Given an active admin, when status is hold, then only held settlements render and the hold filter is current", async () => {
  resetRuntime()
  runtime.listRows = [rows[1]]

  const html = await renderPage({ status: "hold" })

  assert.deepEqual(runtime.listStatuses, ["hold"])
  assert.deepEqual(
    runtime.settlements.map((settlement) => settlement.id),
    ["hold-row"],
  )
  assert.match(html, /aria-current="page"[^>]*href="\/admin\/settlements\?status=hold"/u)
})

test("Given an active admin, when status is all, then no status predicate is requested", async () => {
  resetRuntime()

  await renderPage({ status: "all" })

  assert.deepEqual(runtime.listStatuses, ["all"])
})

test("Given an active admin, when the selected filter has no settlements, then the empty list receives no fallback rows", async () => {
  resetRuntime()
  runtime.listRows = []

  await renderPage({ status: "hold" })

  assert.deepEqual(runtime.listStatuses, ["hold"])
  assert.deepEqual(runtime.settlements, [])
})

test("Given an active admin, when status is invalid or array-valued, then the page redirects without reading settlements", async () => {
  for (const searchParams of [
    { status: "paid" },
    { status: "failed" },
    { status: ["hold", "approved"] },
  ]) {
    resetRuntime()

    const destination = await captureRedirect(() => renderPage(searchParams))

    assert.equal(destination, "/admin/settlements")
    assert.deepEqual(runtime.listStatuses, [])
  }
})

test("Given the settlement reader, when status is all, then it applies no predicate", async () => {
  const calls = []
  const query = {
    eq(column, value) {
      calls.push({ column, value })
      return this
    },
    order() {
      return this
    },
  }

  await listSettlements({ from: () => ({ select: () => query }) }, "all")

  assert.deepEqual(calls, [])
})

test("Given an active admin, when the settlement reader errors, then the page throws without rendering an all-row fallback", async () => {
  resetRuntime()
  runtime.listError = new Error("repository unavailable")

  await assert.rejects(() => renderPage({ status: "hold" }), /AdminSettlementsReadError/u)
  assert.deepEqual(runtime.settlements, [])
})

test("Given a non-admin, when the page is requested, then it redirects before the settlement reader runs", async () => {
  resetRuntime()
  runtime.auth = { kind: "ready", profile: { role: "learner", status: "active" } }

  const destination = await captureRedirect(() => renderPage({ status: "hold" }))

  assert.equal(destination, "/mypage")
  assert.deepEqual(runtime.listStatuses, [])
})
