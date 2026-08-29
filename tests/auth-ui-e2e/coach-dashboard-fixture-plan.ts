import { createHash } from "node:crypto"

export const coachDashboardPersonaAliases = [
  "approved-owner",
  "foreign-coach",
  "applicant-draft",
  "applicant-submitted",
  "applicant-rejected",
  "restricted-suspended",
  "restricted-deleted",
  "learner-reviewer",
] as const

export type CoachDashboardPersonaAlias = (typeof coachDashboardPersonaAliases)[number]
type CoachAlias = "approved-owner" | "foreign-coach"

export type CoachDashboardFixturePlan = Readonly<{
  epoch: string
  graph: Readonly<{
    lessons: readonly Readonly<{ coach: CoachAlias; id: string; title: string }>[]
    notifications: readonly Readonly<{
      createdAt: string
      id: string
      owner: CoachAlias
      payment: string
      reservation: string
    }>[]
    payments: readonly Readonly<{
      id: string
      reservation: string
      status: "paid" | "ready"
    }>[]
    reservations: readonly Readonly<{
      coach: CoachAlias
      id: string
      lesson: string
      schedule: string
      status: "confirmed" | "pending_payment"
    }>[]
    reviews: readonly Readonly<{
      coach: CoachAlias
      createdAt: string
      id: string
      lesson: string
      reservation: string
    }>[]
    schedules: readonly Readonly<{ id: string; lesson: string; startsAt: string }>[]
    settlements: readonly Readonly<{
      coach: CoachAlias
      id: string
      payment: string
      reservation: string
    }>[]
  }>
  personas: readonly Readonly<{
    accountState: "active" | "coach_approved" | "deleted" | "pending_coach" | "suspended"
    alias: CoachDashboardPersonaAlias
    coachState: "approved" | "draft" | "rejected" | "submitted" | null
  }>[]
}>

export function buildCoachDashboardFixturePlan(epoch: string): CoachDashboardFixturePlan {
  const origin = new Date(epoch)
  if (!Number.isFinite(origin.getTime()) || origin.toISOString() !== epoch) {
    throw new Error("SPOLINK_COACH_DASHBOARD_EPOCH must be a canonical ISO timestamp")
  }
  const at = (hours: number) => new Date(origin.getTime() + hours * 3_600_000).toISOString()
  const id = (alias: string) => deterministicUuid(epoch, alias)
  const lessonOwner = id("lesson-owner")
  const lessonForeign = id("lesson-foreign")
  const scheduleOwnerPending = id("schedule-owner-pending")
  const scheduleOwnerConfirmed = id("schedule-owner-confirmed")
  const scheduleForeign = id("schedule-foreign")
  const reservationOwnerPending = id("reservation-owner-pending")
  const reservationOwnerConfirmed = id("reservation-owner-confirmed")
  const reservationForeign = id("reservation-foreign")
  const paymentOwnerPending = id("payment-owner-pending")
  const paymentOwnerConfirmed = id("payment-owner-confirmed")
  const paymentForeign = id("payment-foreign")
  return {
    epoch,
    graph: {
      lessons: [
        { coach: "approved-owner", id: lessonOwner, title: "소유 레슨" },
        { coach: "foreign-coach", id: lessonForeign, title: "외부 레슨" },
      ],
      notifications: [
        {
          createdAt: at(5),
          id: id("notification-owner"),
          owner: "approved-owner",
          payment: paymentOwnerConfirmed,
          reservation: reservationOwnerConfirmed,
        },
        {
          createdAt: at(6),
          id: id("notification-foreign"),
          owner: "foreign-coach",
          payment: paymentForeign,
          reservation: reservationForeign,
        },
      ],
      payments: [
        { id: paymentOwnerPending, reservation: reservationOwnerPending, status: "ready" },
        { id: paymentOwnerConfirmed, reservation: reservationOwnerConfirmed, status: "paid" },
        { id: paymentForeign, reservation: reservationForeign, status: "paid" },
      ],
      reservations: [
        {
          coach: "approved-owner",
          id: reservationOwnerPending,
          lesson: lessonOwner,
          schedule: scheduleOwnerPending,
          status: "pending_payment",
        },
        {
          coach: "approved-owner",
          id: reservationOwnerConfirmed,
          lesson: lessonOwner,
          schedule: scheduleOwnerConfirmed,
          status: "confirmed",
        },
        {
          coach: "foreign-coach",
          id: reservationForeign,
          lesson: lessonForeign,
          schedule: scheduleForeign,
          status: "confirmed",
        },
      ],
      reviews: [
        {
          coach: "approved-owner",
          createdAt: at(4),
          id: id("review-owner"),
          lesson: lessonOwner,
          reservation: reservationOwnerConfirmed,
        },
      ],
      schedules: [
        { id: scheduleOwnerPending, lesson: lessonOwner, startsAt: at(1) },
        { id: scheduleOwnerConfirmed, lesson: lessonOwner, startsAt: at(2) },
        { id: scheduleForeign, lesson: lessonForeign, startsAt: at(3) },
      ],
      settlements: [
        {
          coach: "approved-owner",
          id: id("settlement-owner"),
          payment: paymentOwnerConfirmed,
          reservation: reservationOwnerConfirmed,
        },
        {
          coach: "foreign-coach",
          id: id("settlement-foreign"),
          payment: paymentForeign,
          reservation: reservationForeign,
        },
      ],
    },
    personas: [
      { accountState: "coach_approved", alias: "approved-owner", coachState: "approved" },
      { accountState: "coach_approved", alias: "foreign-coach", coachState: "approved" },
      { accountState: "active", alias: "applicant-draft", coachState: "draft" },
      { accountState: "pending_coach", alias: "applicant-submitted", coachState: "submitted" },
      { accountState: "active", alias: "applicant-rejected", coachState: "rejected" },
      { accountState: "suspended", alias: "restricted-suspended", coachState: null },
      { accountState: "deleted", alias: "restricted-deleted", coachState: null },
      { accountState: "active", alias: "learner-reviewer", coachState: null },
    ],
  }
}

export function coachDashboardGraphId(plan: CoachDashboardFixturePlan, alias: string) {
  return deterministicUuid(plan.epoch, alias)
}

function deterministicUuid(epoch: string, alias: string) {
  const bytes = createHash("sha256").update(`${epoch}:${alias}`).digest().subarray(0, 16)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
