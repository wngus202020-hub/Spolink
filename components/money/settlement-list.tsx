import { CircleDollarSign } from "lucide-react"

import { SettlementActions } from "@/components/money/settlement-actions"

type Settlement = Readonly<{
  created_at: string
  gross_amount: number
  hold_reason: string | null
  id: string
  net_amount: number
  refund_amount: number
  reservation_id: string
  status: string
}>

export function SettlementList({
  admin,
  settlements,
}: Readonly<{ admin: boolean; settlements: readonly Settlement[] }>) {
  if (settlements.length === 0)
    return (
      <section className="grid gap-2 rounded-[var(--radius-lg)] bg-subtle p-6">
        <CircleDollarSign aria-hidden="true" className="size-7 text-tertiary" />
        <h2 className="m-0 text-xl font-bold text-primary">아직 정산 내역이 없어요.</h2>
        <p className="m-0 text-sm text-secondary">
          완료된 수업과 환불 상태가 정리되면 내부 정산 상태가 표시돼요.
        </p>
      </section>
    )
  return (
    <ul className="m-0 grid list-none gap-4 p-0">
      {settlements.map((settlement) => (
        <li
          className="grid gap-4 rounded-[var(--radius-lg)] border border-line bg-canvas p-5 md:grid-cols-[minmax(0,1fr)_340px] md:items-start"
          key={settlement.id}
        >
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-[var(--radius-pill)] bg-inset px-3 py-1 text-sm font-bold text-primary">
                {settlement.status === "approved"
                  ? "승인"
                  : settlement.status === "hold"
                    ? "보류"
                    : "대기"}
              </span>
              <span className="text-xs text-tertiary">{formatDate(settlement.created_at)}</span>
            </div>
            <strong className="text-primary">예약 {settlement.reservation_id}</strong>
            <dl className="m-0 grid gap-1 text-sm text-secondary sm:grid-cols-3">
              <div>
                <dt>총액</dt>
                <dd className="m-0 font-bold text-primary">
                  {settlement.gross_amount.toLocaleString("ko-KR")}원
                </dd>
              </div>
              <div>
                <dt>환불</dt>
                <dd className="m-0">{settlement.refund_amount.toLocaleString("ko-KR")}원</dd>
              </div>
              <div>
                <dt>순액</dt>
                <dd className="m-0 font-bold text-primary">
                  {settlement.net_amount.toLocaleString("ko-KR")}원
                </dd>
              </div>
            </dl>
            {settlement.hold_reason ? (
              <p className="m-0 text-sm text-secondary">보류 사유: {settlement.hold_reason}</p>
            ) : null}
          </div>
          {admin && settlement.status !== "approved" ? (
            <SettlementActions settlementId={settlement.id} />
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value))
}
