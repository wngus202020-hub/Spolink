import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("booking page delegates the reservation mutation to the client form", async () => {
  const page = await read("app/lessons/[lessonId]/booking/page.tsx")

  assert.match(page, /BookingRequestForm/)
  assert.doesNotMatch(page, /예약 요청 준비/)
  assert.doesNotMatch(page, /href=\{detailHref\}[\s\S]*예약 요청/)
})

test("booking page only confirms an open schedule with remaining capacity", async () => {
  const page = await read("app/lessons/[lessonId]/booking/page.tsx")

  assert.match(page, /schedule\.isOpen !== false/)
  assert.match(page, /schedule\.remainingCount === undefined \|\| schedule\.remainingCount > 0/)
  assert.match(page, /hasRequestedSchedule/)
  assert.match(page, /validSchedules\[0\]/)
  assert.match(page, /if \(!selectedSchedule\)/)
  assert.match(page, /다른 일정 선택/)
  assert.match(page, /선택한 일정의 예약 가능 인원이 없어요/)
})

test("booking page preserves exact booking path for login return", async () => {
  const page = await read("app/lessons/[lessonId]/booking/page.tsx")

  assert.match(page, /bookingPath/)
  assert.match(page, /`\/lessons\/\$\{lessonId\}\/booking\?scheduleId=\$\{selectedScheduleId\}`/)
  assert.match(page, /redirect\(`\/auth\/login\?next=\$\{bookingPath\}`\)/)
  assert.doesNotMatch(page, /redirect\("\/auth\/login\?next=\/lessons"\)/)
})

test("payment handoff route renders guarded authoritative payment preparation", async () => {
  const page = await read("app/reservations/[reservationId]/payment/page.tsx")

  assert.match(page, /readPageAuthProfile/)
  assert.match(page, /redirect\(`\/auth\/login\?next=\$\{nextPath\}`\)/)
  assert.match(page, /readPaymentPageData\(reservationId, auth\.profile\.id\)/)
  assert.match(page, /PaymentPreparationForm/)
  assert.doesNotMatch(page, /ComingSoonPage/)
})

test("lesson detail disables unavailable schedules and checks the first valid schedule", async () => {
  const panel = await read("components/lessons/lesson-booking-panel.tsx")

  assert.match(panel, /firstValidScheduleIndex/)
  assert.match(panel, /defaultChecked=\{index === firstValidScheduleIndex\}/)
  assert.match(panel, /disabled=\{!isValidSchedule\}/)
  assert.match(panel, /schedule\.isOpen !== false/)
  assert.match(panel, /schedule\.remainingCount === undefined \|\| schedule\.remainingCount > 0/)
})

test("booking confirmation shows current learner refund policy", async () => {
  const page = await read("app/lessons/[lessonId]/booking/page.tsx")

  assert.match(page, /24시간 이상 70%/)
  assert.match(page, /3시간 이상 24시간 미만 50%/)
  assert.match(page, /3시간 미만 0%/)
  assert.doesNotMatch(page, /전액 환불/)
})

test("booking request form owns submit states and only calls reservation API", async () => {
  const form = await read("components/lessons/booking-request-form.tsx")
  const page = await read("app/lessons/[lessonId]/booking/page.tsx")

  assert.match(form, /예약 요청/)
  assert.match(form, /예약 요청 중/)
  assert.match(form, /aria-live="polite"/)
  assert.match(form, /aria-busy=\{submitting\}/)
  assert.match(form, /createBookingReservation/)
  assert.doesNotMatch(form, /payments\/prepare/)
  assert.doesNotMatch(page, /payments\/prepare/)
})

test("booking request form routes auth failures and focuses recoverable errors", async () => {
  const form = await read("components/lessons/booking-request-form.tsx")
  const page = await read("app/lessons/[lessonId]/booking/page.tsx")

  assert.match(form, /result\.code === "UNAUTHORIZED"/)
  assert.match(form, /returnPath: string/)
  assert.match(form, /router\.push\(`\/auth\/login\?next=\$\{returnPath\}`\)/)
  assert.match(page, /returnPath=\{bookingPath\}/)
  assert.doesNotMatch(form, /router\.push\("\/auth\/login\?next=\/lessons"\)/)
  assert.match(form, /result\.code === "PROFILE_REQUIRED"/)
  assert.match(form, /router\.push\("\/onboarding\/profile"\)/)
  assert.match(form, /alertRef\.current\?\.focus\(\)/)
  assert.match(form, /ref=\{alertRef\}/)
  assert.match(form, /tabIndex=\{-1\}/)
})

async function read(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), "utf8")
}
