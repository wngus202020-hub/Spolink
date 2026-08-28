import { hasSameOrigin } from "../auth/route-security"
import type {
  ReservationLifecycleParseResult,
  ReservationLifecycleRequest,
  ReservationLifecycleWorkflowDependencies,
  ReservationLifecycleWorkflowResult,
} from "./reservation-lifecycle-api"

type Dependencies = Readonly<{
  createSession: (headers: Headers) => Promise<ReservationLifecycleWorkflowDependencies>
  getConfigStatus: () => Readonly<{ configured: boolean }>
  parseRequest: (reservationId: unknown, body: unknown) => ReservationLifecycleParseResult
  respond: (body: unknown, init: ResponseInit) => Response
  runWorkflow: (
    request: ReservationLifecycleRequest,
    dependencies: ReservationLifecycleWorkflowDependencies,
  ) => Promise<ReservationLifecycleWorkflowResult>
}>

export function createReservationLifecycleRouteAdapter(dependencies: Dependencies) {
  return async (request: Request, reservationId: string): Promise<Response> => {
    const headers = new Headers()
    if (!hasSameOrigin(request))
      return error(dependencies.respond, "FORBIDDEN", "Same-origin request required.", 403)
    if (
      request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
      "application/json"
    )
      return error(
        dependencies.respond,
        "UNSUPPORTED_MEDIA_TYPE",
        "Content-Type must be application/json.",
        415,
      )
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return error(
        dependencies.respond,
        "VALIDATION_ERROR",
        "Request body must be valid JSON.",
        422,
      )
    }
    const parsed = dependencies.parseRequest(reservationId, body)
    if (parsed.status === "failure")
      return error(
        dependencies.respond,
        "VALIDATION_ERROR",
        "Reservation lifecycle request is invalid.",
        422,
        parsed.issues,
      )
    if (!dependencies.getConfigStatus().configured)
      return error(
        dependencies.respond,
        "SUPABASE_NOT_CONFIGURED",
        "Supabase is not configured.",
        503,
      )
    const result = await dependencies.runWorkflow(
      parsed.request,
      await dependencies.createSession(headers),
    )
    if (result.status === "failure")
      return error(
        dependencies.respond,
        result.error.code,
        result.error.message,
        result.error.statusCode,
        [],
        headers,
      )
    headers.set("Cache-Control", "private, no-store")
    return dependencies.respond(result.response, { headers, status: result.statusCode })
  }
}

function error(
  respond: Dependencies["respond"],
  code: string,
  message: string,
  status: number,
  details: readonly string[] = [],
  headers?: Headers,
) {
  const resultHeaders = new Headers(headers)
  resultHeaders.set("Cache-Control", "private, no-store")
  return respond({ error: { code, details, message } }, { headers: resultHeaders, status })
}
