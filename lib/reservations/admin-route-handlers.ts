import { z } from "zod"

import { apiDataResponse, apiErrorResponse } from "../api/responses"
import { hasJsonContentType, hasSameOrigin, parseJsonWithSchema } from "../auth/route-security"
import type { WorkflowResult } from "../profile/types"
import {
  type AdminReservationDependencies,
  adminReservationStatusSchema,
  parseAdminReservationQuery,
} from "./admin-operations"
import {
  runAdminReservationList,
  runAdminReservationRead,
  runAdminReservationStatus,
} from "./admin-workflow"

type RouteDependencies = Readonly<{
  createWorkflowDependencies: (headers: Headers) => Promise<AdminReservationDependencies>
  isSupabaseConfigured: () => boolean
}>
type Context = Readonly<{ params: Promise<Readonly<{ reservationId: string }>> }>
const uuid = z.uuid()

export function createListAdminReservationsRouteHandler(dependencies: RouteDependencies) {
  return async (request: Request) => {
    const query = parseAdminReservationQuery(new URL(request.url).searchParams)
    if (!query) return invalid()
    return configured(dependencies, (deps) => runAdminReservationList(query, deps))
  }
}

export function createReadAdminReservationRouteHandler(dependencies: RouteDependencies) {
  return async (_request: Request, context: Context) => {
    const id = await readId(context)
    if (!id) return invalid()
    return configured(dependencies, (deps) => runAdminReservationRead(id, deps))
  }
}

export function createAdminReservationStatusRouteHandler(dependencies: RouteDependencies) {
  return async (request: Request, context: Context) => {
    if (!hasSameOrigin(request)) return error("FORBIDDEN", "Same-origin required.", 403)
    if (!hasJsonContentType(request))
      return error("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.", 415)
    const parsed = await parseJsonWithSchema(request, adminReservationStatusSchema)
    const id = await readId(context)
    if (parsed.status !== "success" || !id) return invalid()
    return configured(dependencies, (deps) =>
      runAdminReservationStatus(id, parsed.value.action, parsed.value.reason ?? null, deps),
    )
  }
}

async function configured<T>(
  dependencies: RouteDependencies,
  run: (dependencies: AdminReservationDependencies) => Promise<WorkflowResult<T>>,
) {
  if (!dependencies.isSupabaseConfigured())
    return error("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503)
  const headers = new Headers()
  const result = await run(await dependencies.createWorkflowDependencies(headers))
  return result.status === "failure"
    ? apiErrorResponse(result.error, headers)
    : apiDataResponse(result.response, result.statusCode, headers)
}

async function readId(context: Context) {
  const params = await context.params
  const parsed = uuid.safeParse(params.reservationId)
  return parsed.success ? parsed.data : null
}

function invalid() {
  return error("VALIDATION_ERROR", "Invalid reservation operation request.", 422)
}

function error(code: string, message: string, statusCode: number) {
  return apiErrorResponse({ code, message, statusCode })
}
