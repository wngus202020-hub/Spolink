import { createHash } from "node:crypto"

const calendarFilename = "spolink-reservation.ics" as const
const productId = "-//SPOLINK//Reservation Calendar//KO" as const
const sensitiveTextReplacement = "[비공개]" as const
const emailPattern = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi
const phonePattern =
  /(?<![\p{L}\p{N}_+-])(?:\+82[ .-]?(?:10[ .-]?\d{4}[ .-]?\d{4}|2[ .-]?\d{3,4}[ .-]?\d{4}|(?:3[1-3]|4[1-4]|5[1-5]|6[1-4])[ .-]?\d{3,4}[ .-]?\d{4})|01[016789][ .-]?\d{3,4}[ .-]?\d{4}|02[ .-]?\d{3,4}[ .-]?\d{4}|0(?:3[1-3]|4[1-4]|5[1-5]|6[1-4])[ .-]?\d{3,4}[ .-]?\d{4}|\+1[ .-]?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]?\d{4})(?![\p{L}\p{N}_+-])/gu
const uuidTextPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const opaqueIdentifierPattern =
  /(?<![a-z0-9_])(?:rsv|pay|payment|toss_order|provider)_[a-z0-9][a-z0-9_-]{4,}[a-z0-9](?![a-z0-9_-])/gi
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

export type ReservationCalendarInput = Readonly<{
  endAt: string
  eventKey: string
  generatedAt: string
  lessonTitle: string
  location: string
  preparationGuidance: string
  startAt: string
}>

export class ReservationCalendarInputError extends Error {
  readonly field: "endAt" | "eventKey" | "generatedAt" | "startAt"
  readonly name = "ReservationCalendarInputError"

  constructor(field: "endAt" | "eventKey" | "generatedAt" | "startAt") {
    super(`Invalid reservation calendar ${field}`)
    this.field = field
  }
}

export function reservationCalendarFilename(): typeof calendarFilename {
  return calendarFilename
}

export function buildReservationCalendar(input: ReservationCalendarInput): Uint8Array {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${productId}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${createUid(input.eventKey)}`,
    `DTSTAMP:${formatUtcTimestamp(input.generatedAt, "generatedAt")}`,
    `DTSTART:${formatUtcTimestamp(input.startAt, "startAt")}`,
    `DTEND:${formatUtcTimestamp(input.endAt, "endAt")}`,
    `SUMMARY:${escapeText(input.lessonTitle)}`,
    `LOCATION:${escapeText(input.location)}`,
    `DESCRIPTION:${escapeText(`준비 안내: ${input.preparationGuidance}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ]

  return new TextEncoder().encode(`${lines.flatMap(foldContentLine).join("\r\n")}\r\n`)
}

function createUid(eventKey: string): string {
  if (eventKey.trim().length === 0) throw new ReservationCalendarInputError("eventKey")

  const digest = createHash("sha256").update(eventKey, "utf8").digest("hex").slice(0, 32)
  return `${digest}@calendar.spolink.local`
}

function formatUtcTimestamp(value: string, field: "endAt" | "generatedAt" | "startAt"): string {
  const timestamp = timestampPattern.test(value) ? new Date(value) : new Date(Number.NaN)
  if (Number.isNaN(timestamp.getTime())) throw new ReservationCalendarInputError(field)

  return timestamp
    .toISOString()
    .replaceAll(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
}

function escapeText(value: string): string {
  return value
    .replaceAll(emailPattern, sensitiveTextReplacement)
    .replaceAll(phonePattern, sensitiveTextReplacement)
    .replaceAll(uuidTextPattern, sensitiveTextReplacement)
    .replaceAll(opaqueIdentifierPattern, sensitiveTextReplacement)
    .replaceAll("\\", "\\\\")
    .replaceAll(/\r\n|\r|\n/g, "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;")
}

function foldContentLine(line: string): readonly string[] {
  const folded: string[] = []
  let segment = ""
  let segmentOctets = 0
  let firstSegment = true

  for (const codePoint of line) {
    const codePointOctets = Buffer.byteLength(codePoint, "utf8")
    const contentLimit = firstSegment ? 75 : 74

    if (segmentOctets + codePointOctets > contentLimit) {
      folded.push(firstSegment ? segment : ` ${segment}`)
      segment = codePoint
      segmentOctets = codePointOctets
      firstSegment = false
    } else {
      segment += codePoint
      segmentOctets += codePointOctets
    }
  }

  folded.push(firstSegment ? segment : ` ${segment}`)
  return folded
}
