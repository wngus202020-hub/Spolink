import type {
  CancelReservationRequest,
  CancelReservationRequestParseResult,
  CancelReservationWorkflowDependencies,
  CancelReservationWorkflowResult,
} from "./cancel-reservation-api"

type JsonResponder = (body: unknown, init: ResponseInit) => Response

type CancelReservationRouteAdapterDependencies = Readonly<{
  createSession: (responseHeaders: Headers) => Promise<CancelReservationWorkflowDependencies>
  getConfigStatus: () => Readonly<{ configured: boolean }>
  parseRequest: (reservationId: unknown, body: unknown) => CancelReservationRequestParseResult
  respond: JsonResponder
  runWorkflow: (
    request: CancelReservationRequest,
    dependencies: CancelReservationWorkflowDependencies,
  ) => Promise<CancelReservationWorkflowResult>
}>

type ApiErrorOptions = Readonly<{
  code: string
  details: readonly string[]
  headers: Headers | undefined
  message: string
  status: number
}>

export function createCancelReservationRouteAdapter(
  dependencies: CancelReservationRouteAdapterDependencies,
) {
  return async function handleCancelReservation(
    request: Request,
    reservationId: string,
  ): Promise<Response> {
    if (!hasSameOrigin(request)) {
      return apiError(dependencies.respond, {
        code: "FORBIDDEN",
        details: [],
        headers: undefined,
        message: "Same-origin request required.",
        status: 403,
      })
    }

    if (!hasJsonContentType(request)) {
      return apiError(dependencies.respond, {
        code: "UNSUPPORTED_MEDIA_TYPE",
        details: [],
        headers: undefined,
        message: "Content-Type must be application/json.",
        status: 415,
      })
    }

    const requestJson = await readRequestJson(request)

    if (requestJson.status === "failure") {
      return apiError(dependencies.respond, {
        code: "VALIDATION_ERROR",
        details: [],
        headers: undefined,
        message: "Request body must be valid JSON.",
        status: 422,
      })
    }

    const parsedRequest = dependencies.parseRequest(reservationId, requestJson.value)

    if (parsedRequest.status === "failure") {
      return apiError(dependencies.respond, {
        code: "VALIDATION_ERROR",
        details: parsedRequest.issues,
        headers: undefined,
        message: "Reservation cancellation request is invalid.",
        status: 422,
      })
    }

    if (!dependencies.getConfigStatus().configured) {
      return apiError(dependencies.respond, {
        code: "SUPABASE_NOT_CONFIGURED",
        details: [],
        headers: undefined,
        message: "Supabase is not configured.",
        status: 503,
      })
    }

    const responseHeaders = new Headers()
    const session = await dependencies.createSession(responseHeaders)
    const workflowResult = await dependencies.runWorkflow(parsedRequest.request, session)

    if (workflowResult.status === "failure") {
      return apiError(dependencies.respond, {
        code: workflowResult.error.code,
        details: [],
        headers: responseHeaders,
        message: workflowResult.error.message,
        status: workflowResult.error.statusCode,
      })
    }

    return dependencies.respond(workflowResult.response, {
      headers: withNoStore(responseHeaders),
      status: workflowResult.statusCode,
    })
  }
}

function apiError(respond: JsonResponder, options: ApiErrorOptions): Response {
  const init: ResponseInit = options.headers
    ? { headers: withNoStore(options.headers), status: options.status }
    : { headers: withNoStore(), status: options.status }

  return respond(
    {
      error: {
        code: options.code,
        details: options.details,
        message: options.message,
      },
    },
    init,
  )
}

function withNoStore(headers?: Headers): Headers {
  const responseHeaders = new Headers(headers)
  responseHeaders.set("Cache-Control", "private, no-store")

  return responseHeaders
}

function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (!origin) return false

  try {
    const originUrl = new URL(origin)
    const requestUrl = new URL(request.url)
    if (originUrl.origin === requestUrl.origin) return true

    const host = request.headers.get("host")
    return host !== null && originUrl.origin === new URL(`${requestUrl.protocol}//${host}`).origin
  } catch (error) {
    if (error instanceof TypeError) return false
    throw error
  }
}

function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type")
  if (!contentType) return false

  const mediaType = contentType.split(";", 1)[0] ?? ""
  return mediaType.trim().toLowerCase() === "application/json"
}

async function readRequestJson(
  request: Request,
): Promise<Readonly<{ status: "success"; value: unknown } | { status: "failure" }>> {
  try {
    const value: unknown = await request.json()

    return { status: "success", value }
  } catch (error) {
    if (error instanceof SyntaxError) return { status: "failure" }
    throw error
  }
}
