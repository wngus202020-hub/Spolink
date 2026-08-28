import { registerHooks } from "node:module"
import { fileURLToPath } from "node:url"
import typescript from "typescript"

const runtimeKey = Symbol.for("spolink.reservation-route-module-runtime")
const runtime = {
  calendarCalls: [],
  calendarHandler: null,
  lifecycleCalls: [],
  lifecycleHandler: null,
}
let importSequence = 0

globalThis[runtimeKey] = runtime

const sharedStubs = new Map([
  ["@/lib/supabase/env", "export const getSupabaseConfigStatus = () => ({ configured: true })"],
  [
    "@/lib/supabase/server",
    "export async function createSupabaseServerClient() { throw new Error('unused server stub') }",
  ],
])

const calendarStubs = new Map([
  [
    "@/lib/reservations/calendar-route-handler",
    `const runtime = globalThis[Symbol.for("spolink.reservation-route-module-runtime")]
export const createReservationCalendarRouteHandler = () => (...args) => {
  runtime.calendarCalls.push(args)
  return runtime.calendarHandler(...args)
}`,
  ],
  [
    "@/lib/reservations/completion-page-data",
    "export async function readReservationCompletionPageData() { throw new Error('unused completion stub') }",
  ],
  [
    "@/lib/reservations/read-model",
    "export const readReservationDetailSnapshot = Symbol.for('spolink.unused-detail-reader')",
  ],
  [
    "@/lib/reservations/reservation-calendar",
    `export function buildReservationCalendar() { throw new Error("unused calendar stub") }
export function reservationCalendarFilename() { return "unused.ics" }`,
  ],
])

const lifecycleStubs = new Map([
  [
    "next/server",
    "export const NextResponse = { json: (body, init) => Response.json(body, init) }",
  ],
  [
    "@/lib/reservations/reservation-lifecycle-api",
    `export function parseReservationLifecycleRequest() { throw new Error("unused parser stub") }
export async function runReservationLifecycleWorkflow() { throw new Error("unused workflow stub") }`,
  ],
  [
    "@/lib/reservations/reservation-lifecycle-route-adapter",
    `const runtime = globalThis[Symbol.for("spolink.reservation-route-module-runtime")]
export const createReservationLifecycleRouteAdapter = () => (...args) => {
  runtime.lifecycleCalls.push(args)
  return runtime.lifecycleHandler(...args)
}`,
  ],
])

registerHooks({
  load(url, context, nextLoad) {
    if (!new URL(url).pathname.endsWith(".ts")) return nextLoad(url, context)

    const loaded = nextLoad(url, { ...context, format: "module" })
    const source = typeof loaded.source === "string" ? loaded.source : loaded.source.toString()
    const result = typescript.transpileModule(source, {
      compilerOptions: {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ES2022,
      },
      fileName: fileURLToPath(url),
    })
    return { format: "module", shortCircuit: true, source: result.outputText }
  },
  resolve(specifier, context, nextResolve) {
    const parentPath = context.parentURL ? new URL(context.parentURL).pathname : ""
    const routeStubs = parentPath.endsWith("/calendar/route.ts")
      ? calendarStubs
      : parentPath.endsWith("/complete/route.ts")
        ? lifecycleStubs
        : null
    const source = routeStubs?.get(specifier) ?? sharedStubs.get(specifier)

    return source
      ? { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` }
      : nextResolve(specifier, context)
  },
})

export function configureReservationRouteModules({ calendarHandler, lifecycleHandler }) {
  runtime.calendarCalls = []
  runtime.calendarHandler = calendarHandler
  runtime.lifecycleCalls = []
  runtime.lifecycleHandler = lifecycleHandler
}

export function reservationRouteModuleCalls() {
  return { calendar: runtime.calendarCalls, lifecycle: runtime.lifecycleCalls }
}

export async function loadReservationRouteModules() {
  importSequence += 1
  const suffix = `?documentation-runtime=${importSequence}`
  const [calendar, lifecycle] = await Promise.all([
    import(`../app/api/reservations/[reservationId]/calendar/route.ts${suffix}`),
    import(`../app/api/reservations/[reservationId]/complete/route.ts${suffix}`),
  ])
  return { calendar, lifecycle }
}
