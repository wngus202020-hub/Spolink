import type { PaymentPageReadSnapshot } from "./payment-page-types"

export async function readPaymentPageSnapshot(
  reservationId: string,
  learnerId: string,
): Promise<PaymentPageReadSnapshot> {
  try {
    const [{ createSupabaseServerComponentClient }, { createSupabaseServiceClient }] =
      await Promise.all([import("@/lib/auth/server-profile"), import("@/lib/supabase/server")])
    const supabase = await createSupabaseServerComponentClient()
    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select(
        "id,learner_id,lesson_id,lesson_schedule_id,payment_expires_at,reserved_price_amount,status",
      )
      .eq("id", reservationId)
      .eq("learner_id", learnerId)
      .maybeSingle()

    if (reservationError) {
      return { kind: "read_failure" }
    }

    if (!reservation) {
      return { kind: "not_found" }
    }

    // The session-scoped reservation query above proves learner ownership. Related
    // lesson and schedule rows may no longer be public after a valid reservation.
    const serviceSupabase = createSupabaseServiceClient()
    const [lessonResult, scheduleResult, paymentResult] = await Promise.all([
      serviceSupabase
        .from("lessons")
        .select("id,title,place_name,address,region,cancellation_policy_summary")
        .eq("id", reservation.lesson_id)
        .maybeSingle(),
      serviceSupabase
        .from("lesson_schedules")
        .select("id,starts_at,ends_at")
        .eq("id", reservation.lesson_schedule_id)
        .maybeSingle(),
      supabase
        .from("payments")
        .select("id,reservation_id,payer_id,status,amount,provider,provider_order_id")
        .eq("reservation_id", reservation.id)
        .eq("payer_id", learnerId)
        .maybeSingle(),
    ])

    if (lessonResult.error || scheduleResult.error || paymentResult.error) {
      return { kind: "read_failure" }
    }

    return {
      kind: "found",
      lesson: lessonResult.data
        ? {
            address: lessonResult.data.address,
            cancellationPolicySummary: lessonResult.data.cancellation_policy_summary,
            id: lessonResult.data.id,
            placeName: lessonResult.data.place_name,
            region: lessonResult.data.region,
            title: lessonResult.data.title,
          }
        : null,
      payment: paymentResult.data
        ? {
            amount: paymentResult.data.amount,
            id: paymentResult.data.id,
            provider: paymentResult.data.provider,
            providerOrderId: paymentResult.data.provider_order_id,
            status: paymentResult.data.status,
          }
        : null,
      reservation: {
        id: reservation.id,
        learnerId: reservation.learner_id,
        lessonId: reservation.lesson_id,
        lessonScheduleId: reservation.lesson_schedule_id,
        paymentExpiresAt: reservation.payment_expires_at,
        reservedPriceAmount: reservation.reserved_price_amount,
        status: reservation.status,
      },
      schedule: scheduleResult.data
        ? {
            endsAt: scheduleResult.data.ends_at,
            id: scheduleResult.data.id,
            startsAt: scheduleResult.data.starts_at,
          }
        : null,
    }
  } catch {
    return { kind: "read_failure" }
  }
}
