import { expandFixedId, fixedIds } from "./ids.mjs"
import { policySlots, raceSlots } from "./slots.mjs"
import { fixtureUsers } from "./users.mjs"

export function buildFixtureRows({ epoch, authIds, tennisSportId }) {
  requireAuthIds(authIds)
  const epochDate = new Date(epoch)
  const iso = (ms) => new Date(ms).toISOString()
  const plusHours = (hours) => iso(epochDate.getTime() + hours * 60 * 60 * 1000)
  const plusMinutes = (minutes) => iso(epochDate.getTime() + minutes * 60 * 1000)

  return {
    epoch: epochDate.toISOString(),
    profiles: buildProfiles(authIds),
    coachProfiles: buildCoachProfiles(authIds, tennisSportId),
    lessons: [lessonRow(tennisSportId)],
    schedules: [
      scheduleRow(fixedIds.baselineOpenSchedule, plusHours(25), plusHours(26), 1, true),
      scheduleRow(fixedIds.baselineClosedSchedule, plusHours(48), plusHours(49), 0, false),
      ...policySlots.map((slot) =>
        scheduleRow(
          expandFixedId(slot.suffix),
          plusHours(slot.startsInHours),
          plusHours(slot.startsInHours + 1),
          slot.reservedCount,
          false,
        ),
      ),
      ...raceSlots.map((slot) =>
        scheduleRow(
          expandFixedId(slot.suffix),
          plusHours(slot.startsInHours),
          plusHours(slot.startsInHours + 1),
          slot.reservedCount,
          false,
        ),
      ),
    ],
    reservations: [
      reservationRow({
        id: fixedIds.historyReservation,
        scheduleId: fixedIds.baselineClosedSchedule,
        learnerId: authIds.learner,
        status: "cancelled_by_user",
        confirmedAt: epochDate.toISOString(),
        cancelledAt: epochDate.toISOString(),
        reason: "E2E historical cancellation",
      }),
      reservationRow({
        id: fixedIds.cancellableReservation,
        scheduleId: fixedIds.baselineOpenSchedule,
        learnerId: authIds.learner,
        status: "confirmed",
        confirmedAt: epochDate.toISOString(),
      }),
      ...[...policySlots, ...raceSlots].map((slot) =>
        reservationRow({
          id: expandFixedId(slot.reservation),
          scheduleId: expandFixedId(slot.suffix),
          learnerId: authIds.learner,
          status: slot.status,
          confirmedAt: slot.status === "confirmed" ? epochDate.toISOString() : null,
          paymentExpiresAt: slot.status === "pending_payment" ? plusMinutes(10) : null,
        }),
      ),
    ],
    payments: [
      paidPaymentRow(
        fixedIds.historyPayment,
        fixedIds.historyReservation,
        authIds.learner,
        "local-seed-401",
        epochDate.toISOString(),
      ),
      paidPaymentRow(
        fixedIds.cancellablePayment,
        fixedIds.cancellableReservation,
        authIds.learner,
        "local-seed-402",
        epochDate.toISOString(),
      ),
      ...[...policySlots, ...raceSlots].map((slot) =>
        paymentRow({
          id: expandFixedId(slot.payment),
          reservationId: expandFixedId(slot.reservation),
          payerId: authIds.learner,
          status: slot.paymentStatus,
          providerKey: slot.providerKey,
          approvedAt: slot.paymentStatus === "paid" ? epochDate.toISOString() : null,
        }),
      ),
    ],
    refunds: [historyRefund(authIds.learner)],
  }
}

function buildProfiles(authIds) {
  return fixtureUsers.map((user) => ({
    id: authIds[user.key],
    role: user.role,
    status: user.status,
    display_name: user.displayName,
    deleted_at: null,
  }))
}

function buildCoachProfiles(authIds, tennisSportId) {
  return [
    {
      id: fixedIds.approvedCoachProfile,
      user_id: authIds.coach,
      status: "approved",
      primary_sport_id: tennisSportId,
      service_region: "서울 성동구",
    },
    {
      id: fixedIds.pendingCoachProfile,
      user_id: authIds.pendingCoach,
      status: "submitted",
      primary_sport_id: tennisSportId,
      service_region: "서울 성동구",
    },
  ]
}

function lessonRow(tennisSportId) {
  return {
    id: fixedIds.lesson,
    coach_profile_id: fixedIds.approvedCoachProfile,
    sport_id: tennisSportId,
    status: "active",
    title: "E2E Tennis Lesson",
    description: "Local Supabase cancellation fixture",
    region: "서울 성동구",
    duration_minutes: 60,
    price_amount: 10001,
    capacity: 2,
  }
}

function scheduleRow(id, startsAt, endsAt, reservedCount, isOpen) {
  return {
    id,
    lesson_id: fixedIds.lesson,
    starts_at: startsAt,
    ends_at: endsAt,
    capacity: 2,
    reserved_count: reservedCount,
    is_open: isOpen,
  }
}

function reservationRow({
  id,
  scheduleId,
  learnerId,
  status,
  confirmedAt = null,
  cancelledAt = null,
  reason = null,
  paymentExpiresAt = null,
}) {
  return {
    id,
    lesson_id: fixedIds.lesson,
    lesson_schedule_id: scheduleId,
    learner_id: learnerId,
    coach_profile_id: fixedIds.approvedCoachProfile,
    status,
    reserved_price_amount: 10001,
    payment_expires_at: paymentExpiresAt,
    confirmed_at: confirmedAt,
    cancelled_at: cancelledAt,
    cancellation_reason: reason,
  }
}

function paidPaymentRow(id, reservationId, payerId, providerKey, approvedAt) {
  return paymentRow({ id, reservationId, payerId, status: "paid", providerKey, approvedAt })
}

function paymentRow({ id, reservationId, payerId, status, providerKey, approvedAt }) {
  return {
    id,
    reservation_id: reservationId,
    payer_id: payerId,
    status,
    provider: "toss",
    provider_order_id: `spolink_${reservationId}`,
    provider_payment_key: providerKey,
    amount: 10001,
    approved_at: approvedAt,
    failed_reason: null,
    raw_payload:
      status === "paid"
        ? {
            orderId: `spolink_${reservationId}`,
            paymentKey: providerKey,
            status: "DONE",
            totalAmount: 10001,
          }
        : null,
  }
}

function historyRefund(learnerId) {
  return {
    id: fixedIds.historyRefund,
    payment_id: fixedIds.historyPayment,
    reservation_id: fixedIds.historyReservation,
    requested_by: learnerId,
    amount: 1,
    reason: "E2E manual visibility refund",
    source: "manual",
    status: "requested",
  }
}

function requireAuthIds(authIds) {
  for (const user of fixtureUsers) {
    if (typeof authIds[user.key] !== "string" || authIds[user.key].length === 0) {
      throw new Error(`Missing Auth UUID for fixture profile: ${user.key}`)
    }
  }
}
