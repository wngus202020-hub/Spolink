import type { SupabaseAppClient } from "../supabase/server"
import {
  type DashboardNotificationRow,
  type DashboardReviewRow,
  readCoachDashboardRows,
} from "./dashboard-repository"

export type CoachDashboardReadInput = Readonly<{
  client: SupabaseAppClient
  coachProfileId: string
  now: Date
  profileId: string
}>

export type KstDayWindow = Readonly<{
  endExclusive: string
  start: string
}>

export type CoachScheduleRow = Readonly<{
  capacity: number
  ends_at: string
  id: string
  is_open: boolean
  lesson_id: string
  reserved_count: number
  starts_at: string
}>

export type CoachReservationRow = Readonly<{
  coach_profile_id: string
  status: string
}>

export type CoachReservationLabels = Readonly<{
  confirmed: "예약 확정"
  pending_payment: "결제 대기"
}>

export type CoachReservationSummary = Readonly<{
  completionPending: number
  confirmed: number
  labels: CoachReservationLabels
  pendingPayment: number
}>

export type CoachDashboard = Readonly<{
  notifications: Readonly<{
    items: readonly Readonly<{ body: string | null; createdAt: string; title: string }>[]
    unreadCount: number
  }>
  pendingSettlements: Readonly<{ count: number; totalNetAmount: number }>
  recentReviews: readonly Readonly<{
    content: string | null
    createdAt: string
    lessonTitle: string
    rating: number
  }>[]
  reservations: CoachReservationSummary
  todaySchedules: readonly Readonly<{
    capacity: number
    endsAt: string
    isOpen: boolean
    lessonTitle: string
    reservedCount: number
    startsAt: string
  }>[]
}>

export class CoachDashboardReadError extends Error {
  readonly code = "COACH_DASHBOARD_READ_FAILED"

  constructor() {
    super("지도자 대시보드 정보를 불러오지 못했습니다.")
    this.name = "CoachDashboardReadError"
  }
}

const kstCalendar = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Seoul",
  year: "numeric",
})

const KST_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1_000
const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000
const TODAY_SCHEDULE_LIMIT = 8
const RESERVATION_LABELS: CoachReservationLabels = Object.freeze({
  confirmed: "예약 확정",
  pending_payment: "결제 대기",
})

export function getKstDayWindow(now: Date): KstDayWindow {
  if (!Number.isFinite(now.getTime())) throw new CoachDashboardReadError()

  const parts = kstCalendar.formatToParts(now)
  const year = readCalendarPart(parts, "year")
  const month = readCalendarPart(parts, "month")
  const day = readCalendarPart(parts, "day")
  const startMilliseconds = Date.UTC(year, month - 1, day) - KST_OFFSET_MILLISECONDS

  return {
    endExclusive: new Date(startMilliseconds + DAY_MILLISECONDS).toISOString(),
    start: new Date(startMilliseconds).toISOString(),
  }
}

export function summarizeCoachSchedules(
  rows: readonly CoachScheduleRow[],
  ownedLessonIds: readonly string[],
  now: Date,
): readonly CoachScheduleRow[] {
  const window = getKstDayWindow(now)
  const startMilliseconds = Date.parse(window.start)
  const endMilliseconds = Date.parse(window.endExclusive)
  const ownedLessons = new Set(ownedLessonIds)
  const candidates: Array<Readonly<{ row: CoachScheduleRow; startsAt: number }>> = []

  for (const row of rows) {
    if (!ownedLessons.has(row.lesson_id)) continue

    const startsAt = parseTimestamp(row.starts_at)
    parseTimestamp(row.ends_at)
    if (startsAt >= startMilliseconds && startsAt < endMilliseconds) {
      candidates.push({ row, startsAt })
    }
  }

  candidates.sort((left, right) => {
    const timestampOrder = left.startsAt - right.startsAt
    if (timestampOrder !== 0) return timestampOrder
    if (left.row.id < right.row.id) return -1
    if (left.row.id > right.row.id) return 1
    return 0
  })

  return candidates.slice(0, TODAY_SCHEDULE_LIMIT).map((candidate) => candidate.row)
}

export function summarizeCoachReservations(
  rows: readonly CoachReservationRow[],
  coachProfileId: string,
): CoachReservationSummary {
  let pendingPayment = 0
  let confirmed = 0

  for (const row of rows) {
    if (row.coach_profile_id !== coachProfileId) continue
    if (row.status === "pending_payment") pendingPayment += 1
    if (row.status === "confirmed") confirmed += 1
  }

  return {
    completionPending: confirmed,
    confirmed,
    labels: RESERVATION_LABELS,
    pendingPayment,
  }
}

export async function readCoachDashboard(input: CoachDashboardReadInput): Promise<CoachDashboard> {
  try {
    const window = getKstDayWindow(input.now)
    const rows = await readCoachDashboardRows({
      client: input.client,
      coachProfileId: input.coachProfileId,
      endExclusive: window.endExclusive,
      profileId: input.profileId,
      start: window.start,
    })
    const lessonTitles = new Map<string, string>()
    for (const lesson of rows.lessons) {
      requireNonEmptyString(lesson.id)
      requireNonEmptyString(lesson.title)
      lessonTitles.set(lesson.id, lesson.title)
    }

    const schedules = summarizeCoachSchedules(rows.schedules, [...lessonTitles.keys()], input.now)
    const reservations = rows.reservationStatuses.map((row) => {
      if (row.status !== "pending_payment" && row.status !== "confirmed") {
        throw new CoachDashboardReadError()
      }
      return { coach_profile_id: input.coachProfileId, status: row.status }
    })

    return {
      notifications: {
        items: rows.notifications.map(mapNotification),
        unreadCount: rows.unreadNotificationCount,
      },
      pendingSettlements: summarizeSettlements(rows.settlements),
      recentReviews: rows.reviews.map((row) => mapReview(row, lessonTitles)),
      reservations: summarizeCoachReservations(reservations, input.coachProfileId),
      todaySchedules: schedules.map((row) => {
        const lessonTitle = lessonTitles.get(row.lesson_id)
        if (lessonTitle === undefined) throw new CoachDashboardReadError()
        requireNonNegativeInteger(row.capacity)
        requireNonNegativeInteger(row.reserved_count)
        if (typeof row.is_open !== "boolean") throw new CoachDashboardReadError()
        parseTimestamp(row.ends_at)
        return {
          capacity: row.capacity,
          endsAt: row.ends_at,
          isOpen: row.is_open,
          lessonTitle,
          reservedCount: row.reserved_count,
          startsAt: row.starts_at,
        }
      }),
    }
  } catch {
    throw new CoachDashboardReadError()
  }
}

function summarizeSettlements(
  rows: readonly Readonly<{ net_amount: number }>[],
): Readonly<{ count: number; totalNetAmount: number }> {
  let totalNetAmount = 0
  for (const row of rows) {
    requireNonNegativeInteger(row.net_amount)
    totalNetAmount += row.net_amount
    if (!Number.isSafeInteger(totalNetAmount)) throw new CoachDashboardReadError()
  }
  return { count: rows.length, totalNetAmount }
}

function mapReview(
  row: DashboardReviewRow,
  lessonTitles: ReadonlyMap<string, string>,
): CoachDashboard["recentReviews"][number] {
  requireTimestamp(row.created_at)
  if (!Number.isInteger(row.rating) || row.rating < 1 || row.rating > 5) {
    throw new CoachDashboardReadError()
  }
  if (row.content !== null && typeof row.content !== "string") throw new CoachDashboardReadError()
  const lessonTitle = lessonTitles.get(row.lesson_id)
  if (lessonTitle === undefined) throw new CoachDashboardReadError()
  return {
    content: row.content,
    createdAt: row.created_at,
    lessonTitle,
    rating: row.rating,
  }
}

function mapNotification(
  row: DashboardNotificationRow,
): CoachDashboard["notifications"]["items"][number] {
  requireNonEmptyString(row.title)
  requireTimestamp(row.created_at)
  if (row.body !== null && typeof row.body !== "string") throw new CoachDashboardReadError()
  return { body: row.body, createdAt: row.created_at, title: row.title }
}

function requireNonEmptyString(value: string): void {
  if (typeof value !== "string" || value.length === 0) throw new CoachDashboardReadError()
}

function requireNonNegativeInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new CoachDashboardReadError()
}

function requireTimestamp(value: string): void {
  if (typeof value !== "string") throw new CoachDashboardReadError()
  parseTimestamp(value)
}

function readCalendarPart(parts: readonly Intl.DateTimeFormatPart[], type: string): number {
  const part = parts.find((candidate) => candidate.type === type)
  if (part === undefined) throw new CoachDashboardReadError()
  const value = Number(part.value)
  if (!Number.isInteger(value)) throw new CoachDashboardReadError()
  return value
}

function parseTimestamp(value: string): number {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new CoachDashboardReadError()
  return timestamp
}
