import { NextResponse } from "next/server"

import {
  parseReservationLifecycleRequest,
  runReservationLifecycleWorkflow,
} from "@/lib/reservations/reservation-lifecycle-api"
import { createReservationLifecycleRouteAdapter } from "@/lib/reservations/reservation-lifecycle-route-adapter"
import { getSupabaseConfigStatus } from "@/lib/supabase/env"
import { createSupabaseServerClient } from "@/lib/supabase/server"

const handle = createReservationLifecycleRouteAdapter({
  createSession: async (headers) => {
    const supabase = await createSupabaseServerClient(headers)
    return {
      getVerifiedAuthUser: async () => {
        const { data, error } = await supabase.auth.getClaims()
        const id = typeof data?.claims.sub === "string" ? data.claims.sub : null
        return error || !id ? null : { id }
      },
      transitionReservation: async (args) => {
        const { data, error } = await supabase.rpc("transition_reservation_lifecycle", args)
        return { errorCode: error?.code ?? null, row: data?.length === 1 ? data[0] : null }
      },
    }
  },
  getConfigStatus: getSupabaseConfigStatus,
  parseRequest: (id, body) => parseReservationLifecycleRequest(id, "no-show", body),
  respond: (body, init) => NextResponse.json(body, init),
  runWorkflow: runReservationLifecycleWorkflow,
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reservationId: string }> },
) {
  return handle(request, (await params).reservationId)
}
