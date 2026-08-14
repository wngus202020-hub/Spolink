import { NextResponse } from "next/server"

import {
  parseCancelReservationRequest,
  runCancelReservationWorkflow,
} from "@/lib/reservations/cancel-reservation-api"
import { createCancelReservationRouteAdapter } from "@/lib/reservations/cancel-reservation-route-adapter"
import { getSupabaseConfigStatus } from "@/lib/supabase/env"
import { createSupabaseServerClient } from "@/lib/supabase/server"

type RouteContext = Readonly<{
  params: Promise<Readonly<{ reservationId: string }>>
}>

const handleCancelReservation = createCancelReservationRouteAdapter({
  createSession: async (responseHeaders) => {
    const supabase = await createSupabaseServerClient(responseHeaders)

    return {
      cancelReservation: async (args) => {
        const { data: cancellations, error } = await supabase.rpc("cancel_reservation", args)
        const cancellation = cancellations?.length === 1 ? cancellations[0] : null

        return {
          cancellation,
          errorCode: error?.code ?? null,
        }
      },
      getCurrentProfile: async (userId) => {
        const { data: profile, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .maybeSingle()

        return { errorCode: error?.code ?? null, profile }
      },
      getVerifiedAuthUser: async () => {
        const { data, error } = await supabase.auth.getClaims()
        const userId = typeof data?.claims.sub === "string" ? data.claims.sub : null

        return error || !userId ? null : { id: userId }
      },
    }
  },
  getConfigStatus: getSupabaseConfigStatus,
  parseRequest: parseCancelReservationRequest,
  respond: (body, init) => NextResponse.json(body, init),
  runWorkflow: runCancelReservationWorkflow,
})

export async function POST(request: Request, { params }: RouteContext) {
  const { reservationId } = await params

  return handleCancelReservation(request, reservationId)
}
