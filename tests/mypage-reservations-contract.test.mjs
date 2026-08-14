import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const paths = {
  detail: "app/mypage/reservations/[reservationId]/page.tsx",
  header: "components/layout/public-header.tsx",
  hub: "app/mypage/page.tsx",
  list: "app/mypage/reservations/page.tsx",
  model: "lib/reservations/read-model.ts",
}

test("My Page routes use the shared auth/profile gates and header", async () => {
  const [hub, list, detail] = await Promise.all([
    read(paths.hub),
    read(paths.list),
    read(paths.detail),
  ])

  for (const source of [hub, list, detail]) {
    assert.match(source, /readPageAuthProfile\(\)/u)
    assert.match(source, /auth\.kind === "unauthenticated" \|\| auth\.kind === "unconfigured"/u)
    assert.match(source, /redirect\("\/onboarding\/profile"\)/u)
    assert.match(source, /<PublicHeader auth=\{auth\} \/>/u)
  }

  assert.match(hub, /redirect\("\/auth\/login\?next=\/mypage"\)/u)
  assert.match(list, /redirect\("\/auth\/login\?next=\/mypage\/reservations"\)/u)
  assert.match(detail, /redirect\(`\/auth\/login\?next=\$\{nextPath\}`\)/u)
  assert.match(detail, /readReservationDetailData\(reservationId, auth\.profile\.id\)/u)
  assert.match(detail, /reservationData\.state === "not_found"/u)
  assert.match(detail, /notFound\(\)/u)
})

test("authenticated stable 마이 link points to My Page and logout remains a POST form", async () => {
  const header = await read(paths.header)

  assert.match(header, /href="\/mypage"/u)
  assert.match(header, />\s*마이\s*</u)
  assert.match(header, /whitespace-nowrap/u)
  assert.match(header, /shrink-0/u)
  assert.match(header, /<form action="\/auth\/logout" method="post">/u)
  assert.match(header, /type="submit"/u)
})

test("My Page hub contains profile identity, reservations, and favorites entries", async () => {
  const hub = await read(paths.hub)

  assert.match(hub, /\{auth\.profile\.display_name\}/u)
  assert.match(hub, /auth\.profile\.default_region/u)
  assert.match(hub, /href="\/mypage\/reservations"/u)
  assert.match(hub, /href="\/mypage\/favorites"/u)
  assert.match(hub, /찜한 레슨/u)
  assert.match(hub, /리뷰 관리/u)
  assert.match(hub, /준비중/u)
  assert.doesNotMatch(hub, /ComingSoonPage|Sport Mate|Activity Record|지도자 대시보드/u)
})

test("reservation list provides all server filters, 20-row pagination, and required summaries", async () => {
  const [list, model] = await Promise.all([read(paths.list), read(paths.model)])

  for (const filter of [
    "all",
    "pending",
    "confirmed",
    "completed",
    "cancelled",
    "no_show",
    "disputed",
  ]) {
    assert.match(model, new RegExp(`value: "${filter}"`, "u"))
  }

  assert.match(model, /RESERVATIONS_PER_PAGE = 20/u)
  assert.match(list, /normalizeReservationFilter\(query\.status\)/u)
  assert.match(list, /normalizeReservationPage\(query\.page\)/u)
  assert.match(list, /readReservationListData\(auth\.profile\.id, filter, page\)/u)
  assert.match(list, /reservation\.lessonTitle/u)
  assert.match(list, /reservation\.scheduleLabel/u)
  assert.match(list, /reservation\.location/u)
  assert.match(list, /reservation\.amountText/u)
  assert.match(list, /reservation\.paymentSummary/u)
  assert.match(list, /reservation\.refundSummary/u)
  assert.match(list, /href=\{`\/mypage\/reservations\/\$\{reservation\.id\}`\}/u)
  assert.match(list, /: "\/lessons"/u)
  assert.match(list, /href=\{href\}/u)
  assert.match(list, /min-h-11 shrink-0 items-center rounded-\[var\(--radius-pill\)\]/u)
  assert.match(list, /이 상태의 예약이 없어요/u)
  assert.match(list, /예약 목록 페이지를 다시 선택해요/u)
  assert.match(list, /전체 보기/u)
  assert.match(list, /첫 페이지 보기/u)
})

test("payment continuation links are rendered only behind the authoritative model flag", async () => {
  const [list, detail] = await Promise.all([read(paths.list), read(paths.detail)])

  for (const source of [list, detail]) {
    assert.match(source, /reservation\.canContinuePayment \? \(/u)
    assert.match(source, /href=\{`\/reservations\/\$\{reservation\.id\}\/payment`\}/u)
  }
})

test("reservation detail contains all required information and informational cancellation policy", async () => {
  const detail = await read(paths.detail)

  for (const label of [
    "레슨 일정",
    "장소",
    "지도자",
    "예약 금액",
    "결제 상태",
    "환불 상태",
    "24시간 이상",
    "3시간 이상 24시간 미만",
    "3시간 미만",
    "서버에서 계산",
    "이 화면에서는 취소 요청을 제출할 수 없어요",
  ]) {
    assert.match(detail, new RegExp(label, "u"))
  }

  assert.match(detail, /reservation\.cancellation\.availableByStatus/u)
  assert.match(detail, /reservation\.cancellation\.estimatedRefundText/u)
})

test("My Page surfaces never submit cancellation or integrate checkout and confirmation", async () => {
  const sources = await Promise.all([read(paths.hub), read(paths.list), read(paths.detail)])
  const ui = sources.join("\n")

  assert.doesNotMatch(ui, /<form\b|fetch\s*\(|method=["']post["']/iu)
  assert.doesNotMatch(ui, /\/api\/reservations\/[^\s"'`]*\/cancel/iu)
  assert.doesNotMatch(ui, /\/api\/payments\/confirm|\/payments\/confirm/iu)
  assert.doesNotMatch(ui, /requestPayment|TossPayments|PaymentWidget|toss\.im|tossPayments/iu)
  assert.doesNotMatch(ui, /provider_payment_key|provider_refund_key|raw_payload|learner_id/iu)
})

async function read(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), "utf8")
}
