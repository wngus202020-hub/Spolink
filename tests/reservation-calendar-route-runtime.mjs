import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import typescript from "typescript"

const projectRootUrl = pathToFileURL(`${process.cwd()}/`)
const runtimeKey = Symbol.for("spolink.reservation-calendar-route-runtime")

const runtime = {
  adapterHandler: null,
  buildCalls: [],
  calendarBytes: new TextEncoder().encode("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"),
  claims: { sub: "00000000-0000-4000-8000-000000000001" },
  claimsCalls: 0,
  completion: null,
  completionCalls: [],
  configured: true,
  cookies: ["sb-session=runtime-refreshed; Path=/; HttpOnly"],
  serverCalls: 0,
}
let importSequence = 0

globalThis[runtimeKey] = runtime

const stubSources = new Map([
  [
    "@/lib/reservations/completion-page-data",
    `const runtime = globalThis[Symbol.for("spolink.reservation-calendar-route-runtime")]
export const readReservationCompletionPageData = (...args) => {
  runtime.completionCalls.push(args)
  return runtime.completion
}`,
  ],
  [
    "@/lib/reservations/read-model",
    "export const readReservationDetailSnapshot = Symbol.for('spolink.calendar-detail-reader')",
  ],
  [
    "@/lib/reservations/reservation-calendar",
    `const runtime = globalThis[Symbol.for("spolink.reservation-calendar-route-runtime")]
export const buildReservationCalendar = (input) => {
  runtime.buildCalls.push(input)
  return runtime.calendarBytes
}
export const reservationCalendarFilename = () => "spolink-runtime.ics"`,
  ],
  [
    "@/lib/supabase/env",
    `const runtime = globalThis[Symbol.for("spolink.reservation-calendar-route-runtime")]
export const getSupabaseConfigStatus = () => ({ configured: runtime.configured })`,
  ],
  [
    "@/lib/supabase/server",
    `const runtime = globalThis[Symbol.for("spolink.reservation-calendar-route-runtime")]
export const createSupabaseServerClient = async (headers) => {
  runtime.serverCalls += 1
  for (const cookie of runtime.cookies) headers.append("Set-Cookie", cookie)
  return { auth: { getClaims: async () => {
    runtime.claimsCalls += 1
    return runtime.claims ? { data: { claims: runtime.claims }, error: null } : { data: null, error: null }
  } } }
}`,
  ],
])

registerHooks({
  load(url, context, nextLoad) {
    if (new URL(url).pathname.endsWith(".ts")) {
      const loaded = nextLoad(url, { ...context, format: "module" })
      const source = typeof loaded.source === "string" ? loaded.source : loaded.source.toString()
      const fileName = fileURLToPath(url)
      const result = typescript.transpileModule(source, {
        compilerOptions: {
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
    if (specifier === "@/lib/reservations/calendar-route-handler" && runtime.adapterHandler) {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(`
const runtime = globalThis[Symbol.for("spolink.reservation-calendar-route-runtime")]
export const createReservationCalendarRouteHandler = () => {
  const handler = runtime.adapterHandler
  return (...args) => handler(...args)
}`)}`,
      }
    }
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
      const candidate = new URL(`${baseUrl.href}.ts`)
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context)
    }
    return nextResolve(specifier, context)
  },
})

export function configureCalendarRouteRuntime({ claims, completion, configured = true, cookies }) {
  runtime.buildCalls = []
  runtime.claims = claims
  runtime.claimsCalls = 0
  runtime.completion = completion
  runtime.completionCalls = []
  runtime.configured = configured
  runtime.cookies = cookies
  runtime.serverCalls = 0
}

export function calendarRouteRuntimeCalls() {
  return {
    build: runtime.buildCalls,
    claims: runtime.claimsCalls,
    completion: runtime.completionCalls,
    server: runtime.serverCalls,
  }
}

export async function loadReservationCalendarRoute(adapterHandler = null) {
  runtime.adapterHandler = adapterHandler
  importSequence += 1
  try {
    return await import(
      `../app/api/reservations/[reservationId]/calendar/route.ts?runtime=${importSequence}`
    )
  } finally {
    runtime.adapterHandler = null
  }
}
