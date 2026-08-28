import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { installBookingConfirmationModuleResolver } from "./booking-confirmation-module-resolver.mjs"
import {
  captureBookingRoute,
  configureBookingRuntime,
  readBookingRuntimeEvents,
} from "./booking-confirmation-runtime-stubs.mjs"
import { inspectRenderedHtml } from "./react-html-runtime.mjs"

installBookingConfirmationModuleResolver()

const [{ default: LessonBookingPage }, { BookingRequestForm }, { LessonBookingPanel }] =
  await Promise.all([
    import("../app/lessons/[lessonId]/booking/page.tsx"),
    import("../components/lessons/booking-request-form.tsx"),
    import("../components/lessons/lesson-booking-panel.tsx"),
  ])

const lessonId = "00000000-0000-4000-8000-000000000101"
const scheduleId = "00000000-0000-4000-8000-000000000201"
const reservationId = "00000000-0000-4000-8000-000000000301"

test("booking page redirects authentication states to the exact requested booking route", async () => {
  for (const [auth, destination] of [
    [{ kind: "unauthenticated" }, loginPath()],
    [{ kind: "unconfigured" }, loginPath()],
    [{ kind: "profile_required", userId: "user-contract-id" }, "/onboarding/profile"],
  ]) {
    configureBookingRuntime({ auth, bookingResult: successResult(), lessons: [lesson()] })

    assert.deepEqual(await captureBookingRoute(() => runBookingPage(scheduleId)), {
      destination,
      kind: "redirect",
    })
    assert.deepEqual(readBookingRuntimeEvents().bookingCalls, [])
  }
})

test("booking page renders only an open schedule with capacity and exact confirmation contracts", async () => {
  configureBookingRuntime({
    auth: readyAuth(),
    bookingResult: successResult(),
    lessons: [lesson()],
  })

  const markup = renderToStaticMarkup(await runBookingPage(scheduleId))

  for (const label of [
    "예약 정보를 확인해요",
    "선택 일정",
    "예약 요청",
    "24시간 이상 70% 환불",
    "3시간 이상 24시간 미만 50% 환불",
    "3시간 미만 0% 환불",
  ]) {
    assert.ok(markup.includes(label), `missing rendered label: ${label}`)
  }
  await inspectRenderedHtml(await runBookingPage(scheduleId), async ({ page }) => {
    await assertFormValue(page, "lessonId", lessonId)
    await assertFormValue(page, "lessonScheduleId", scheduleId)
  })
  assert.equal(markup.includes("결제 요청 준비"), false)
  assert.equal(markup.includes("예약 확정"), false)
})

test("booking page renders recovery instead of mutation form for an unavailable requested schedule", async () => {
  configureBookingRuntime({
    auth: readyAuth(),
    bookingResult: successResult(),
    lessons: [lesson()],
  })

  const markup = renderToStaticMarkup(await runBookingPage("00000000-0000-4000-8000-000000000299"))

  assert.ok(markup.includes("선택한 일정의 예약 가능 인원이 없어요"))
  assert.ok(markup.includes("다른 일정 선택"))
  assert.equal(markup.includes("name="), false)
  assert.deepEqual(readBookingRuntimeEvents().bookingCalls, [])
})

test("lesson detail disables unavailable schedules and selects the first valid schedule", async () => {
  await inspectRenderedHtml(LessonBookingPanel({ lesson: lesson() }), async ({ page }) => {
    const form = page.locator("form")
    assert.equal(await form.getAttribute("action"), `/lessons/${lessonId}/booking`)
    await assertRadioState(page, scheduleId, { checked: true, disabled: false })
    await assertRadioState(page, "closed-schedule", { checked: false, disabled: true })
    await assertRadioState(page, "full-schedule", { checked: false, disabled: true })
  })
})

test("booking request submits exactly one reservation mutation and hands success to payment", async () => {
  configureBookingRuntime({
    auth: readyAuth(),
    bookingResult: successResult(),
    lessons: [lesson()],
  })
  const form = BookingRequestForm(formProps())
  const submit = findElement(form, "form").props.onSubmit
  let prevented = 0

  await Promise.all([
    submit({ preventDefault: () => prevented++ }),
    submit({ preventDefault: () => prevented++ }),
  ])

  assert.equal(prevented, 2)
  assert.deepEqual(readBookingRuntimeEvents().bookingCalls, [
    { lessonId, lessonScheduleId: scheduleId },
  ])
  assert.deepEqual(readBookingRuntimeEvents().routerPushes, [
    `/reservations/${reservationId}/payment`,
  ])
})

test("booking request routes account failures without payment or confirmation mutation", async () => {
  for (const [bookingResult, destination] of [
    [{ code: "UNAUTHORIZED", message: "로그인이 필요해요.", status: "failure" }, loginPath()],
    [
      { code: "PROFILE_REQUIRED", message: "프로필 설정이 필요해요.", status: "failure" },
      "/onboarding/profile",
    ],
  ]) {
    configureBookingRuntime({ auth: readyAuth(), bookingResult, lessons: [lesson()] })

    await findElement(BookingRequestForm(formProps()), "form").props.onSubmit({
      preventDefault() {},
    })

    assert.deepEqual(readBookingRuntimeEvents().bookingCalls, [
      { lessonId, lessonScheduleId: scheduleId },
    ])
    assert.deepEqual(readBookingRuntimeEvents().routerPushes, [destination])
  }
})

function runBookingPage(requestedScheduleId) {
  return LessonBookingPage({
    params: Promise.resolve({ lessonId }),
    searchParams: Promise.resolve({ scheduleId: requestedScheduleId }),
  })
}

function formProps() {
  return {
    lessonId,
    lessonScheduleId: scheduleId,
    priceText: "50,000원",
    returnPath: bookingPath(),
  }
}

function bookingPath() {
  return `/lessons/${lessonId}/booking?scheduleId=${scheduleId}`
}

function loginPath() {
  return `/auth/login?next=${bookingPath()}`
}

function readyAuth() {
  return {
    coachProfile: null,
    kind: "ready",
    profile: { display_name: "학습자", id: "learner-id" },
  }
}

function successResult() {
  return {
    paymentHref: `/reservations/${reservationId}/payment`,
    reservation: {
      id: reservationId,
      paymentExpiresAt: "2026-08-19T01:00:00.000Z",
      reservedPriceAmount: 50_000,
      status: "pending_payment",
    },
    status: "success",
  }
}

function lesson() {
  return {
    capacityText: "정원 4명",
    coachName: "김코치",
    durationText: "60분",
    id: lessonId,
    preparationText: "운동화",
    priceText: "50,000원",
    refundSummary: "24시간 전 70% 환불",
    schedules: [
      {
        capacityText: "2자리 남음",
        id: scheduleId,
        isOpen: true,
        label: "8월 20일 오전 10시",
        remainingCount: 2,
      },
      {
        capacityText: "마감",
        id: "closed-schedule",
        isOpen: false,
        label: "8월 21일 오전 10시",
        remainingCount: 2,
      },
      {
        capacityText: "마감",
        id: "full-schedule",
        isOpen: true,
        label: "8월 22일 오전 10시",
        remainingCount: 0,
      },
    ],
    sport: "테니스",
    summary: "입문자를 위한 레슨",
    title: "입문 테니스 레슨",
    venueText: "강남 테니스장",
  }
}

function findElement(node, type) {
  if (!node || typeof node !== "object") return null
  if (node.type === type) return node
  const children = Array.isArray(node.props?.children)
    ? node.props.children
    : [node.props?.children]
  for (const child of children) {
    const found = findElement(child, type)
    if (found) return found
  }
  return null
}

async function assertFormValue(page, name, value) {
  assert.equal(await page.locator(`input[name="${name}"]`).inputValue(), value)
}

async function assertRadioState(page, value, expected) {
  const radio = page.locator(`input[type="radio"][value="${value}"]`)
  assert.equal(await radio.isChecked(), expected.checked)
  assert.equal(await radio.isDisabled(), expected.disabled)
}
