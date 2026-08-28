import { createReservationCalendarRouteHandler } from "@/lib/reservations/calendar-route-handler"
import { readReservationCompletionPageData } from "@/lib/reservations/completion-page-data"
import { readReservationDetailSnapshot } from "@/lib/reservations/read-model"
import {
  buildReservationCalendar,
  reservationCalendarFilename,
} from "@/lib/reservations/reservation-calendar"
import { getSupabaseConfigStatus } from "@/lib/supabase/env"
import { createSupabaseServerClient } from "@/lib/supabase/server"

const handle = createReservationCalendarRouteHandler({
  buildCalendar: buildReservationCalendar,
  createSession: async (responseHeaders) => {
    const supabase = await createSupabaseServerClient(responseHeaders)

    return {
      getVerifiedAuthUser: async () => {
        const { data, error } = await supabase.auth.getClaims()
        const id = typeof data?.claims.sub === "string" ? data.claims.sub : null
        return error || !id ? null : { id }
      },
      readCompletion: (reservationId, learnerId) =>
        readReservationCompletionPageData(reservationId, learnerId, readReservationDetailSnapshot),
    }
  },
  getConfigStatus: getSupabaseConfigStatus,
  getFilename: reservationCalendarFilename,
  now: () => new Date(),
})

export async function GET(
  request: Request,
  { params }: Readonly<{ params: Promise<{ reservationId: string }> }>,
) {
  return handle(request, (await params).reservationId)
}
