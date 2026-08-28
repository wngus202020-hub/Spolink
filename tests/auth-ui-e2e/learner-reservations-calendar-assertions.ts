import { createHash } from "node:crypto"
import { expect, type Page } from "@playwright/test"

type CalendarExpectation = Readonly<{
  endsAt: string
  lessonTitle: string
  startsAt: string
}>

export async function downloadCalendar(page: Page, expected: CalendarExpectation) {
  const downloadEvent = page.waitForEvent("download")
  await page.getByRole("link", { name: "캘린더 등록" }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe("spolink-reservation.ics")
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const calendarBytes = Buffer.concat(chunks)
  const calendarText = calendarBytes.toString("utf8")
  expect(Buffer.from(calendarText, "utf8")).toEqual(calendarBytes)
  expect(calendarText.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true)
  expect(calendarText.endsWith("END:VCALENDAR\r\n")).toBe(true)
  expect(calendarText.replaceAll("\r\n", "")).not.toContain("\n")
  expect(calendarText.match(/BEGIN:VEVENT/gu)).toHaveLength(1)
  expect(
    calendarBytes.includes(Buffer.from(`DTSTART:${calendarTimestamp(expected.startsAt)}\r\n`)),
  ).toBe(true)
  expect(
    calendarBytes.includes(Buffer.from(`DTEND:${calendarTimestamp(expected.endsAt)}\r\n`)),
  ).toBe(true)
  expect(calendarText).toContain(`SUMMARY:${expected.lessonTitle}`)
  expect(calendarText).not.toMatch(/010-|provider_order|toss_order|40000000/iu)
  return {
    bytes: calendarBytes.byteLength,
    sha256: createHash("sha256").update(calendarBytes).digest("hex"),
  }
}

function calendarTimestamp(value: string) {
  return new Date(value)
    .toISOString()
    .replaceAll(/[-:]/g, "")
    .replace(/\.\d{3}Z$/u, "Z")
}
