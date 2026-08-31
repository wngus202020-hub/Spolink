import { existsSync, readFileSync } from "node:fs"
import { createRequire, registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createElement } from "react"
import typescript from "typescript"

const workspaceUrl = pathToFileURL(`${process.cwd()}/`).href
const runtimeKey = Symbol.for("spolink.mypage-reviews-ui-runtime")
export const readyAuth = { kind: "ready", profile: { id: "learner-ui-contract" } }
export const require = createRequire(import.meta.url)

export class RouteSignal extends Error {
  constructor(destination) {
    super(destination)
    this.destination = destination
  }
}

export const runtime = {
  auth: readyAuth,
  calls: [],
  createElement,
  data: null,
  readAuth: async () => runtime.auth,
  readReviewHistory: async (...args) => {
    runtime.calls.push(args)
    return runtime.data
  },
  redirect(destination) {
    throw new RouteSignal(destination)
  },
}

globalThis[runtimeKey] = runtime

const stubSources = new Map([
  [
    "next/link",
    'const runtime = globalThis[Symbol.for("spolink.mypage-reviews-ui-runtime")]; export default function Link({ children, href, ...props }) { return runtime.createElement("a", { ...props, href }, children) }',
  ],
  [
    "next/navigation",
    'const runtime = globalThis[Symbol.for("spolink.mypage-reviews-ui-runtime")]; export const redirect = (destination) => runtime.redirect(destination)',
  ],
  ["@/components/layout/public-header", "export function PublicHeader() { return null }"],
  [
    "@/components/ui/status-badge",
    'const runtime = globalThis[Symbol.for("spolink.mypage-reviews-ui-runtime")]; export function StatusBadge({ children, tone }) { return runtime.createElement("span", { "data-tone": tone }, children) }',
  ],
  [
    "@/lib/auth/page-auth",
    'const runtime = globalThis[Symbol.for("spolink.mypage-reviews-ui-runtime")]; export const readPageAuthProfile = () => runtime.readAuth()',
  ],
  [
    "@/lib/reviews/read-model",
    'const runtime = globalThis[Symbol.for("spolink.mypage-reviews-ui-runtime")]; export const normalizeReviewHistoryPage = (value) => typeof value === "string" && /^\\d+$/u.test(value) && Number(value) > 0 ? Number(value) : 1; export const readReviewHistoryData = (...args) => runtime.readReviewHistory(...args)',
  ],
])

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".ts") || url.endsWith(".tsx")) {
      const result = typescript.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: {
          jsx: typescript.JsxEmit.ReactJSX,
          module: typescript.ModuleKind.ESNext,
          target: typescript.ScriptTarget.ES2022,
        },
        fileName: fileURLToPath(url),
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
      ? new URL(specifier.slice(2), workspaceUrl)
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

export function configureRuntime({ auth = readyAuth, data = null } = {}) {
  runtime.auth = auth
  runtime.calls = []
  runtime.data = data
}

export async function captureRouteSignal(action) {
  try {
    await action()
  } catch (error) {
    if (error instanceof RouteSignal) return error.destination
    throw error
  }
  return null
}

export async function loadReviewsPage() {
  return import("../app/mypage/reviews/page.tsx")
}

export async function loadReviewComponents() {
  const [list, row] = await Promise.all([
    import("../components/reviews/review-history-list.tsx"),
    import("../components/reviews/review-history-row.tsx"),
  ])
  return { ...list, ...row }
}
