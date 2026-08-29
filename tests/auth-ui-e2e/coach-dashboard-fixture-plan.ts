import { createHash } from "node:crypto"

import {
  buildDashboardNotifications,
  buildDashboardPersonas,
  buildDashboardSettlements,
} from "./coach-dashboard-fixture-catalog"

export const coachDashboardPersonaAliases = [
  "approved-owner",
  "empty-coach",
  "foreign-coach",
  "profile-required",
  "active-learner",
  "applicant-draft",
  "applicant-submitted",
  "applicant-rejected",
  "restricted-suspended",
  "restricted-deleted",
  "learner-reviewer",
] as const

export type CoachDashboardPersonaAlias = (typeof coachDashboardPersonaAliases)[number]
export type CoachDashboardOwnerAlias = "approved-owner" | "foreign-coach"
type ReviewStatus = "deleted" | "hidden" | "visible"
type SettlementStatus = "hold" | "pending"

type Lesson = Readonly<{
  alias: string
  id: string
  owner: CoachDashboardOwnerAlias
  title: string
}>
type Schedule = Readonly<{
  alias: string
  id: string
  isOpen: boolean
  lesson: string
  owner: CoachDashboardOwnerAlias
  reservedCount: number
  startsAt: string
}>
type Reservation = Readonly<{
  alias: string
  id: string
  lesson: string
  owner: CoachDashboardOwnerAlias
  schedule: string
  status: "completed" | "confirmed" | "pending_payment"
}>
type Payment = Readonly<{
  id: string
  reservation: string
  status: "paid" | "ready"
}>
type Review = Readonly<{
  alias: string
  content: string
  createdAt: string
  id: string
  lesson: string
  owner: CoachDashboardOwnerAlias
  reservation: string
  status: ReviewStatus
}>
type Notification = Readonly<{
  alias: string
  body: string
  createdAt: string
  id: string
  owner: CoachDashboardOwnerAlias
  payment: string
  read: boolean
  reservation: string
  title: string
}>
type Settlement = Readonly<{
  alias: string
  id: string
  netAmount: number
  owner: CoachDashboardOwnerAlias
  payment: string
  reservation: string
  status: SettlementStatus
}>

export type CoachDashboardFixturePlan = Readonly<{
  epoch: string
  graph: Readonly<{
    lessons: readonly Lesson[]
    notifications: readonly Notification[]
    payments: readonly Payment[]
    reservations: readonly Reservation[]
    reviews: readonly Review[]
    schedules: readonly Schedule[]
    settlements: readonly Settlement[]
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
  const lessonDefinitions = [
    ["owner-day-start", "approved-owner", "OWNER_DAY_START_LESSON"],
    ["owner-closed", "approved-owner", "OWNER_CLOSED_LESSON"],
    ["owner-zero", "approved-owner", "OWNER_ZERO_LESSON"],
    ["owner-confirmed-two", "approved-owner", "OWNER_CONFIRMED_TWO_LESSON"],
    ["owner-confirmed-three", "approved-owner", "OWNER_CONFIRMED_THREE_LESSON"],
    ["owner-day-end", "approved-owner", "OWNER_DAY_END_EXCLUDED"],
    ["foreign", "foreign-coach", "FOREIGN_LESSON_SENTINEL"],
  ] as const
  const lessons = lessonDefinitions.map(([alias, owner, title]) => ({
    alias,
    id: id(`lesson-${alias}`),
    owner,
    title,
  }))
  const lessonId = (alias: string) => requireAlias(lessons, alias).id
  const scheduleDefinitions = [
    ["owner-day-start", "approved-owner", "owner-day-start", -12, true, 1],
    ["owner-closed", "approved-owner", "owner-closed", 1, false, 1],
    ["owner-zero-reservations", "approved-owner", "owner-zero", 2, true, 0],
    ["owner-confirmed-two", "approved-owner", "owner-confirmed-two", 3, true, 1],
    ["owner-confirmed-three", "approved-owner", "owner-confirmed-three", 4, true, 1],
    ["owner-day-end-excluded", "approved-owner", "owner-day-end", 12, true, 0],
    ["foreign-visible", "foreign-coach", "foreign", 5, true, 1],
  ] as const
  const schedules = scheduleDefinitions.map(
    ([alias, owner, lessonAlias, hours, isOpen, reservedCount]) => ({
      alias,
      id: id(`schedule-${alias}`),
      isOpen,
      lesson: lessonId(lessonAlias),
      owner,
      reservedCount,
      startsAt: at(hours),
    }),
  )
  const scheduleId = (alias: string) => requireAlias(schedules, alias).id
  const reservationDefinitions = [
    ["owner-pending-1", "approved-owner", "owner-day-start", "owner-day-start", "pending_payment"],
    ["owner-pending-2", "approved-owner", "owner-closed", "owner-closed", "pending_payment"],
    ["owner-confirmed-1", "approved-owner", "owner-zero", "owner-zero-reservations", "confirmed"],
    [
      "owner-confirmed-2",
      "approved-owner",
      "owner-confirmed-two",
      "owner-confirmed-two",
      "confirmed",
    ],
    [
      "owner-confirmed-3",
      "approved-owner",
      "owner-confirmed-three",
      "owner-confirmed-three",
      "confirmed",
    ],
    ["foreign-pending", "foreign-coach", "foreign", "foreign-visible", "pending_payment"],
    ["foreign-confirmed", "foreign-coach", "foreign", "foreign-visible", "confirmed"],
  ] as const
  const reservations: Reservation[] = reservationDefinitions.map(
    ([alias, owner, lessonAlias, scheduleAlias, status]) => ({
      alias,
      id: id(`reservation-${alias}`),
      lesson: lessonId(lessonAlias),
      owner,
      schedule: scheduleId(scheduleAlias),
      status,
    }),
  )
  const reviewDefinitions = [
    ["owner-visible-latest-1", "approved-owner", "visible", 9, "OWNER_REVIEW_ALPHA"],
    ["owner-visible-latest-2", "approved-owner", "visible", 8, "OWNER_REVIEW_BETA"],
    ["owner-visible-latest-3", "approved-owner", "visible", 7, "OWNER_REVIEW_GAMMA"],
    ["owner-visible-old-excluded", "approved-owner", "visible", 6, "OWNER_REVIEW_OLD_EXCLUDED"],
    ["owner-hidden-excluded", "approved-owner", "hidden", 11, "HIDDEN_REVIEW_SENTINEL"],
    ["owner-deleted-excluded", "approved-owner", "deleted", 12, "DELETED_REVIEW_SENTINEL"],
    ["foreign-visible", "foreign-coach", "visible", 10, "FOREIGN_REVIEW_SENTINEL"],
  ] as const
  for (const [alias, owner] of reviewDefinitions) {
    reservations.push({
      alias: `review-${alias}`,
      id: id(`reservation-review-${alias}`),
      lesson: lessonId(owner === "approved-owner" ? "owner-day-start" : "foreign"),
      owner,
      schedule: scheduleId(owner === "approved-owner" ? "owner-day-start" : "foreign-visible"),
      status: "completed",
    })
  }
  const reservationId = (alias: string) => requireAlias(reservations, alias).id
  const payments = reservationDefinitions.map(([alias, , , , status]) => ({
    id: id(`payment-${alias}`),
    reservation: reservationId(alias),
    status: status === "pending_payment" ? ("ready" as const) : ("paid" as const),
  }))
  const paymentId = (alias: string) =>
    payments.find((payment) => payment.reservation === reservationId(alias))?.id ?? failAlias(alias)
  return {
    epoch,
    graph: {
      lessons,
      notifications: buildDashboardNotifications(id, at, reservationId, paymentId),
      payments,
      reservations,
      reviews: reviewDefinitions.map(([alias, owner, status, hours, content]) => ({
        alias,
        content,
        createdAt: at(hours),
        id: id(`review-${alias}`),
        lesson: lessonId(owner === "approved-owner" ? "owner-day-start" : "foreign"),
        owner,
        reservation: reservationId(`review-${alias}`),
        status,
      })),
      schedules,
      settlements: buildDashboardSettlements(id, reservationId, paymentId),
    },
    personas: buildDashboardPersonas(),
  }
}

export function coachDashboardGraphId(plan: CoachDashboardFixturePlan, alias: string) {
  return deterministicUuid(plan.epoch, alias)
}

function requireAlias<Row extends { alias: string }>(rows: readonly Row[], alias: string): Row {
  return rows.find((row) => row.alias === alias) ?? failAlias(alias)
}

function failAlias(alias: string): never {
  throw new Error(`Missing deterministic fixture alias: ${alias}`)
}

function deterministicUuid(epoch: string, alias: string) {
  const bytes = createHash("sha256").update(`${epoch}:${alias}`).digest().subarray(0, 16)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
