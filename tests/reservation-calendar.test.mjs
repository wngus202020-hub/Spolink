import assert from "node:assert/strict"
import test from "node:test"

import {
  buildReservationCalendar,
  ReservationCalendarInputError,
  reservationCalendarFilename,
} from "../lib/reservations/reservation-calendar.ts"

const fixture = Object.freeze({
  endAt: "2026-08-20T11:30:00+09:00",
  eventKey: "opaque-calendar-event-key",
  generatedAt: "2026-08-18T03:04:05.678Z",
  lessonTitle: "한강 테니스 입문",
  location: "서울숲 테니스장 1번 코트",
  preparationGuidance: "운동화와 물을 준비해 주세요.",
  startAt: "2026-08-20T10:00:00+09:00",
})

const decode = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes)

test("reservation calendar emits deterministic UTC RFC 5545 bytes for a Korean lesson", () => {
  // Given
  const expected = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SPOLINK//Reservation Calendar//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:cdd9e8a6cb4e378249fb3dcb8f072851@calendar.spolink.local",
    "DTSTAMP:20260818T030405Z",
    "DTSTART:20260820T010000Z",
    "DTEND:20260820T023000Z",
    "SUMMARY:한강 테니스 입문",
    "LOCATION:서울숲 테니스장 1번 코트",
    "DESCRIPTION:준비 안내: 운동화와 물을 준비해 주세요.",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n")

  // When
  const first = buildReservationCalendar(fixture)
  const second = buildReservationCalendar(fixture)

  // Then
  assert.ok(first instanceof Uint8Array)
  assert.deepEqual(first, second)
  assert.equal(decode(first), expected)
  assert.equal(decode(first).replaceAll("\r\n", "").includes("\n"), false)
})

test("reservation calendar escapes malicious TEXT before folding", () => {
  // Given
  const malicious = Object.freeze({
    ...fixture,
    lessonTitle: "테니스\\기초,집중;반\r\nATTENDEE:urn:injected",
    location: "1번 코트\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:침입",
    preparationGuidance: "물병\nURL:https://evil.example\rX-PAYMENT-ID:pay-secret",
  })

  // When
  const calendar = decode(buildReservationCalendar(malicious))
  const unfoldedLines = unfold(calendar)

  // Then
  assert.equal(unfoldedLines.filter((line) => line === "BEGIN:VEVENT").length, 1)
  assert.equal(unfoldedLines.filter((line) => line === "END:VEVENT").length, 1)
  assert.equal(
    unfoldedLines.some((line) => line.startsWith("ATTENDEE:")),
    false,
  )
  assert.equal(
    unfoldedLines.some((line) => line.startsWith("URL:")),
    false,
  )
  assert.equal(
    unfoldedLines.some((line) => line.startsWith("X-PAYMENT-ID:")),
    false,
  )
  assert.ok(unfoldedLines.includes("SUMMARY:테니스\\\\기초\\,집중\\;반\\nATTENDEE:urn:injected"))
  assert.ok(unfoldedLines.includes("LOCATION:1번 코트\\nEND:VEVENT\\nBEGIN:VEVENT\\nSUMMARY:침입"))
})

test("reservation calendar folds every physical line at 75 octets on UTF-8 boundaries", () => {
  // Given
  const longKoreanTitle = "한글🙂테니스,".repeat(24)

  // When
  const bytes = buildReservationCalendar({ ...fixture, lessonTitle: longKoreanTitle })
  const calendar = decode(bytes)
  const physicalLines = calendar.split("\r\n").slice(0, -1)
  const summary = unfold(calendar).find((line) => line.startsWith("SUMMARY:"))

  // Then
  assert.ok(physicalLines.every((line) => Buffer.byteLength(line, "utf8") <= 75))
  assert.ok(physicalLines.some((line) => line.startsWith(" ")))
  assert.equal(summary, `SUMMARY:${longKoreanTitle.replaceAll(",", "\\,")}`)
})

test("reservation calendar UID is stable, opaque, and changes with the event key", () => {
  // Given
  const sensitiveEventKey = "reservation-00000000-payment-provider-12345"

  // When
  const first = unfold(
    decode(buildReservationCalendar({ ...fixture, eventKey: sensitiveEventKey })),
  ).find((line) => line.startsWith("UID:"))
  const repeat = unfold(
    decode(buildReservationCalendar({ ...fixture, eventKey: sensitiveEventKey })),
  ).find((line) => line.startsWith("UID:"))
  const different = unfold(
    decode(buildReservationCalendar({ ...fixture, eventKey: `${sensitiveEventKey}-other` })),
  ).find((line) => line.startsWith("UID:"))

  // Then
  assert.equal(first, repeat)
  assert.notEqual(first, different)
  assert.equal(first?.includes(sensitiveEventKey), false)
  assert.match(first ?? "", /^UID:[0-9a-f]{32}@calendar\.spolink\.local$/)
})

test("reservation calendar removes sensitive values from every untrusted TEXT field", () => {
  // Given
  const sensitiveValues = [
    { kind: "email", value: "learner.name+calendar@example.co.kr" },
    { kind: "Korean mobile", value: "010-1234-5678" },
    { kind: "domestic Seoul landline", value: "02-1234-5678" },
    { kind: "domestic regional landline", value: "031-123-4567" },
    { kind: "international Korean mobile", value: "+82 10 8765 4321" },
    { kind: "international Seoul landline spaces", value: "+82 2 1234 5678" },
    { kind: "international Seoul landline hyphens", value: "+82-2-1234-5678" },
    { kind: "international regional landline spaces", value: "+82 31 123 4567" },
    { kind: "international regional landline hyphens", value: "+82-51-1234-5678" },
    { kind: "North American phone", value: "+1 (415) 555-2671" },
    { kind: "raw UUID", value: "deadbeef-cafe-4abc-8def-feedfacecafe" },
    { kind: "UUIDv7", value: "01890f7e-7b5c-7d2a-8e4f-acdeffedcbaa" },
    { kind: "rsv token", value: "rsv_A1b2C3d4E5f6" },
    { kind: "pay token", value: "pay_P9q8R7s6T5u4" },
    { kind: "payment token", value: "payment_Q1w2E3r4T5y6" },
    { kind: "Toss order token", value: "toss_order_V7b6N5m4K3j2" },
    { kind: "provider token", value: "provider_Z9x8C7v6B5n4" },
  ]
  const usefulPrefix = "초급자도 즐겁게 참여할 수 있어요."
  const usefulSuffix = "코트에서 만나요."
  const payload = `${usefulPrefix} ${sensitiveValues.map(({ value }) => value).join(" / ")} ${usefulSuffix}`
  const leaks = []

  for (const field of ["lessonTitle", "location", "preparationGuidance"]) {
    // When
    const calendar = decode(buildReservationCalendar({ ...fixture, [field]: payload }))
    const unfoldedCalendar = unfold(calendar).join("\r\n")

    // Then
    leaks.push(
      ...sensitiveValues
        .filter(({ value }) => unfoldedCalendar.includes(value))
        .map(({ kind }) => `${field}:${kind}`),
    )
    assert.equal(unfoldedCalendar.includes(usefulPrefix), true)
    assert.equal(unfoldedCalendar.includes(usefulSuffix), true)
  }

  assert.deepEqual(leaks, [], "untrusted TEXT fields leaked sensitive identifier kinds")
  assert.equal(decode(buildReservationCalendar(fixture)).includes(fixture.eventKey), false)
  assert.equal(reservationCalendarFilename(), "spolink-reservation.ics")
  assert.match(reservationCalendarFilename(), /^[a-z0-9.-]+$/)
})

test("reservation calendar preserves ordinary order, payment, and provider wording", () => {
  // Given
  const ordinaryText = Object.freeze({
    lessonTitle: "Order Fitness high-intensity 테니스와 Provider Pilates 입문",
    location: "Payment Hall river-side Seoul 서울숲 센터",
    preparationGuidance:
      "Practice order-based training and provider-guided balance drills. 운동화를 준비해 주세요.",
  })

  // When
  const calendar = unfold(decode(buildReservationCalendar({ ...fixture, ...ordinaryText }))).join(
    "\r\n",
  )

  // Then
  const missingFields = Object.entries(ordinaryText)
    .filter(([, value]) => !calendar.includes(value))
    .map(([field]) => field)
  assert.deepEqual(missingFields, [], "ordinary wording was redacted")
})

test("reservation calendar preserves long alphanumeric and hyphen tokens in every TEXT field", () => {
  // Given
  const ordinaryTokens = [
    { kind: "verifier token", value: "12345678-1234-notuuid-1234-123456789012" },
    { kind: "alphanumeric token", value: "alpha1234567890-beta-9876543210omega" },
    { kind: "training token", value: "training-202608201030-advanced-zone9" },
    { kind: "season token", value: "season-2026-08-20-session-1030" },
    { kind: "court token", value: "court2-12345678-training" },
    { kind: "plus token", value: "fitness+821012345678-plan" },
    { kind: "underscore token", value: "zone_01012345678_alpha" },
    { kind: "embedded Seoul token", value: "seoul-02-1234-5678-center" },
    { kind: "international embedded token", value: "international+82-2-1234-5678-course" },
  ]
  const prefix = "유용한 시작 문구"
  const suffix = "useful ending text"
  const payload = `${prefix} ${ordinaryTokens.map(({ value }) => value).join(" / ")} ${suffix}`
  const missing = []

  for (const field of ["lessonTitle", "location", "preparationGuidance"]) {
    // When
    const calendar = unfold(
      decode(buildReservationCalendar({ ...fixture, [field]: payload })),
    ).join("\r\n")

    // Then
    missing.push(
      ...ordinaryTokens
        .filter(({ value }) => !calendar.includes(value))
        .map(({ kind }) => `${field}:${kind}`),
    )
    assert.equal(calendar.includes(prefix), true)
    assert.equal(calendar.includes(suffix), true)
  }

  assert.deepEqual(missing, [], "ordinary long tokens were partially redacted")
})

test("reservation calendar rejects malformed timestamps and empty event keys", () => {
  // Given
  const malformed = [
    { ...fixture, generatedAt: "not-a-timestamp" },
    { ...fixture, startAt: "2026-99-99" },
    { ...fixture, endAt: "" },
    { ...fixture, eventKey: "" },
  ]

  // When / Then
  for (const input of malformed) {
    assert.throws(() => buildReservationCalendar(input), ReservationCalendarInputError)
  }
})

function unfold(calendar) {
  return calendar
    .replaceAll(/\r\n[ \t]/g, "")
    .split("\r\n")
    .slice(0, -1)
}
