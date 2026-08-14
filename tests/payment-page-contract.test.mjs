import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("payment page reads the learner-owned authoritative payment state", async () => {
  const page = await read("app/reservations/[reservationId]/payment/page.tsx")

  assert.doesNotMatch(page, /ComingSoonPage/)
  assert.match(page, /readPaymentPageData\(reservationId, auth\.profile\.id\)/)
  assert.match(page, /PaymentPreparationForm/)
  assert.match(page, /redirect\(`\/auth\/login\?next=\$\{nextPath\}`\)/)
  assert.match(page, /redirect\("\/onboarding\/profile"\)/)
})

test("payment page renders every authoritative state and required reservation summary", async () => {
  const page = await read("app/reservations/[reservationId]/payment/page.tsx")

  for (const state of [
    "pending_valid",
    "expired_pending",
    "ready",
    "confirmed",
    "terminal",
    "unavailable",
    "not_found",
    "read_failure",
  ]) {
    assert.match(page, new RegExp(`${state}:`))
  }

  for (const label of [
    "예약 금액",
    "결제 준비 기한",
    "예약 레슨",
    "레슨 일정",
    "장소",
    "환불 기준",
  ]) {
    assert.match(page, new RegExp(label))
  }
})

test("payment preparation CTA is limited to valid pending and ready states", async () => {
  const page = await read("app/reservations/[reservationId]/payment/page.tsx")

  assert.match(
    page,
    /paymentPageData\.state === "pending_valid" \|\| paymentPageData\.state === "ready"/,
  )
  assert.match(page, /showPreparation \? \(/)
  assert.match(page, /initialPayment=\{viewModel\.readyPayment\}/)
  assert.doesNotMatch(page, /결제 완료|예약 확정/)
})

test("payment preparation form submits explicitly and guards duplicate requests", async () => {
  const form = await read("components/payments/payment-preparation-form.tsx")

  assert.match(form, /onSubmit=\{submitPreparation\}/)
  assert.match(form, /preparePayment\(reservationId\)/)
  assert.match(form, /if \(submittingRef\.current\) return/)
  assert.match(form, /submittingRef\.current = true/)
  assert.match(form, /disabled=\{submitting\}/)
  assert.match(form, /aria-busy=\{submitting\}/)
  assert.match(form, /aria-live="polite"/)
})

test("payment preparation form routes auth failures and focuses inline errors", async () => {
  const form = await read("components/payments/payment-preparation-form.tsx")

  assert.match(form, /result\.code === "UNAUTHORIZED"/)
  assert.match(form, /router\.push\(`\/auth\/login\?next=\$\{returnPath\}`\)/)
  assert.match(form, /result\.code === "PROFILE_REQUIRED"/)
  assert.match(form, /router\.push\("\/onboarding\/profile"\)/)
  assert.match(form, /role="alert"/)
  assert.match(form, /alertRef\.current\?\.focus\(\)/)
  assert.match(form, /ref=\{alertRef\}/)
  assert.match(form, /tabIndex=\{-1\}/)
})

test("prepared UI stays prepare-only and does not integrate checkout", async () => {
  const [page, form] = await Promise.all([
    read("app/reservations/[reservationId]/payment/page.tsx"),
    read("components/payments/payment-preparation-form.tsx"),
  ])
  const paymentUi = `${page}\n${form}`

  assert.match(form, /결제 요청 준비됨/)
  assert.doesNotMatch(paymentUi, /결제 완료|예약 확정/)
  assert.doesNotMatch(paymentUi, /requestPayment|TossPayments|PaymentWidget|\/payments\/confirm/)
})

async function read(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), "utf8")
}
