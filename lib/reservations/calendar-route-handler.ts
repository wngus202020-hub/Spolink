import type { ReservationCompletionPageData } from "./completion-page-data"
import type { ReservationCalendarInput } from "./reservation-calendar"

type CalendarRouteSession = Readonly<{
  getVerifiedAuthUser: () => Promise<Readonly<{ id: string }> | null>
  readCompletion: (
    reservationId: string,
    learnerId: string,
  ) => Promise<ReservationCompletionPageData>
}>

type CalendarRouteDependencies = Readonly<{
  buildCalendar: (input: ReservationCalendarInput) => Uint8Array
  createSession: (responseHeaders: Headers) => Promise<CalendarRouteSession>
  getConfigStatus: () => Readonly<{ configured: boolean }>
  getFilename: () => string
  now: () => Date
}>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export function createReservationCalendarRouteHandler(dependencies: CalendarRouteDependencies) {
  return async function handleReservationCalendar(
    request: Request,
    reservationId: string,
  ): Promise<Response> {
    void request

    if (!dependencies.getConfigStatus().configured) {
      return errorResponse("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503)
    }

    const responseHeaders = new Headers()
    const session = await dependencies.createSession(responseHeaders)
    const user = await session.getVerifiedAuthUser()

    if (!user) {
      return errorResponse("UNAUTHENTICATED", "Authentication required.", 401, responseHeaders)
    }

    if (!uuidPattern.test(reservationId)) {
      return notFoundResponse(responseHeaders)
    }

    const completion = await session.readCompletion(reservationId, user.id)

    switch (completion.state) {
      case "not_found":
        return notFoundResponse(responseHeaders)
      case "read_failure":
        return errorResponse(
          "RESERVATION_READ_FAILED",
          "Reservation could not be read.",
          503,
          responseHeaders,
        )
      case "mismatch":
      case "pending":
      case "terminal":
        return conflictResponse(responseHeaders)
      case "complete": {
        const viewModel = completion.viewModel
        if (!viewModel?.startsAt || !viewModel.endsAt) {
          return conflictResponse(responseHeaders)
        }

        let calendar: Uint8Array
        try {
          calendar = dependencies.buildCalendar({
            endAt: viewModel.endsAt,
            eventKey: reservationId,
            generatedAt: dependencies.now().toISOString(),
            lessonTitle: viewModel.lessonTitle,
            location: viewModel.location,
            preparationGuidance: viewModel.preparation ?? "별도 준비물 안내가 없어요.",
            startAt: viewModel.startsAt,
          })
        } catch (error) {
          if (error instanceof Error) {
            return errorResponse(
              "CALENDAR_BUILD_FAILED",
              "Calendar could not be created.",
              503,
              responseHeaders,
            )
          }
          throw error
        }
        const headers = withNoStore(responseHeaders)
        headers.set("Content-Disposition", `attachment; filename="${dependencies.getFilename()}"`)
        headers.set("Content-Type", "text/calendar; charset=utf-8")
        const responseBody = new ArrayBuffer(calendar.byteLength)
        new Uint8Array(responseBody).set(calendar)

        return new Response(responseBody, { headers, status: 200 })
      }
    }
  }
}

function conflictResponse(headers: Headers): Response {
  return errorResponse(
    "RESERVATION_NOT_ELIGIBLE",
    "Reservation is not eligible for calendar download.",
    409,
    headers,
  )
}

function notFoundResponse(headers: Headers): Response {
  return errorResponse("RESERVATION_NOT_FOUND", "Reservation not found.", 404, headers)
}

function errorResponse(code: string, message: string, status: number, headers?: Headers): Response {
  const responseHeaders = withNoStore(headers)
  responseHeaders.set("Content-Type", "application/json; charset=utf-8")

  return new Response(JSON.stringify({ error: { code, details: [], message } }), {
    headers: responseHeaders,
    status,
  })
}

function withNoStore(headers?: Headers): Headers {
  const responseHeaders = new Headers(headers)
  responseHeaders.set("Cache-Control", "private, no-store")
  return responseHeaders
}
