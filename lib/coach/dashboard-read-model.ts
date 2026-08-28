import type { SupabaseAppClient } from "../supabase/server"

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
