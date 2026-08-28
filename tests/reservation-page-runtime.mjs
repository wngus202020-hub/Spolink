import { existsSync, readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import typescript from "typescript"

const projectRootUrl = pathToFileURL(`${process.cwd()}/`)
const runtimeKey = Symbol.for("spolink.reservation-page-runtime")

class RouteSignal extends Error {
  constructor(kind, destination) {
    super(`${kind}:${destination ?? ""}`)
    this.destination = destination
    this.kind = kind
  }
}

const runtime = {
  auth: null,
  completion: null,
  completionCalls: [],
  detail: null,
  detailCalls: [],
  notFound() {
    throw new RouteSignal("not-found", null)
  },
  readAuth: async () => runtime.auth,
  readCompletion: async (...args) => {
    runtime.completionCalls.push(args)
    return runtime.completion
  },
  readDetail: async (...args) => {
    runtime.detailCalls.push(args)
    return runtime.detail
  },
  redirect(destination) {
    throw new RouteSignal("redirect", destination)
  },
}

globalThis[runtimeKey] = runtime

const stubSources = new Map([
  [
    "next/navigation",
    `const runtime = globalThis[Symbol.for("spolink.reservation-page-runtime")]
export const notFound = () => runtime.notFound()
export const redirect = (destination) => runtime.redirect(destination)
export const useRouter = () => ({
  refresh() {},
  replace(destination) { runtime.redirect(destination) },
})`,
  ],
  ["@/components/layout/public-header", "export function PublicHeader() { return null }"],
  [
    "@/lib/auth/page-auth",
    `const runtime = globalThis[Symbol.for("spolink.reservation-page-runtime")]
export const readPageAuthProfile = () => runtime.readAuth()`,
  ],
  [
    "@/lib/reservations/completion-page-data",
    `const runtime = globalThis[Symbol.for("spolink.reservation-page-runtime")]
export const readReservationCompletionPageData = (...args) => runtime.readCompletion(...args)`,
  ],
  [
    "@/lib/reservations/read-model",
    `const runtime = globalThis[Symbol.for("spolink.reservation-page-runtime")]
export const readReservationDetailData = (...args) => runtime.readDetail(...args)
export async function readReservationDetailSnapshot() { throw new Error("unused read stub") }`,
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
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(stubSource)}`,
      }
    }

    if (specifier === "next/link") {
      return nextResolve("next/link.js", context)
    }

    const baseUrl = specifier.startsWith("@/")
      ? new URL(specifier.slice(2), projectRootUrl)
      : context.parentURL && specifier.startsWith(".")
        ? new URL(specifier, context.parentURL)
        : null
    if (baseUrl) {
      for (const extension of [".ts", ".tsx"]) {
        const candidate = new URL(`${baseUrl.href}${extension}`)
        if (existsSync(fileURLToPath(candidate))) {
          return nextResolve(candidate.href, context)
        }
      }
    }
    return nextResolve(specifier, context)
  },
})

export function configureReservationPageRuntime({ auth, completion = null, detail = null }) {
  runtime.auth = auth
  runtime.completion = completion
  runtime.completionCalls = []
  runtime.detail = detail
  runtime.detailCalls = []
}

export function reservationPageCalls() {
  return {
    completion: runtime.completionCalls.map((args) => args.slice(0, 2)),
    detail: runtime.detailCalls.map((args) => args.slice(0, 2)),
  }
}

export async function captureRouteSignal(action) {
  try {
    await action()
  } catch (error) {
    if (error instanceof RouteSignal) {
      return { destination: error.destination, kind: error.kind }
    }
    throw error
  }
  return null
}

export async function loadCompletionPage() {
  return await import("../app/reservations/[reservationId]/complete/page.tsx")
}

export async function loadMyReservationDetailPage() {
  return await import("../app/mypage/reservations/[reservationId]/page.tsx")
}
