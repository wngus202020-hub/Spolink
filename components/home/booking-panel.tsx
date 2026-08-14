import { BadgeCheck, CalendarCheck, ShieldCheck, WalletCards } from "lucide-react"
import Link from "next/link"

const bookingChecks = [
  {
    icon: BadgeCheck,
    text: "인증 승인된 지도자만 수업을 등록해요.",
  },
  {
    icon: CalendarCheck,
    text: "일정을 선택한 뒤 결제 전 예약 정보를 확인해요.",
  },
  {
    icon: WalletCards,
    text: "결제 성공 검증 후 예약이 확정돼요.",
  },
] as const

export function BookingPanel() {
  return (
    <aside className="rounded-[var(--radius-xl)] border border-line bg-elevated p-6 [box-shadow:var(--shadow-panel)]">
      <div className="grid gap-2 border-b border-line-subtle pb-5">
        <span className="inline-flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent">
          <ShieldCheck aria-hidden="true" className="size-5" strokeWidth={2} />
        </span>
        <h2 className="text-[28px] font-bold leading-[1.32] text-primary">예약 전 확인</h2>
        <p className="text-sm text-secondary">
          가격, 일정, 환불 기준 확인 후 결제하면 예약이 확정돼요.
        </p>
      </div>

      <div className="grid gap-4 py-5">
        {bookingChecks.map((item) => {
          const Icon = item.icon

          return (
            <div className="flex gap-3" key={item.text}>
              <Icon aria-hidden="true" className="mt-0.5 size-5 text-accent" strokeWidth={1.8} />
              <p className="m-0 text-sm text-secondary">{item.text}</p>
            </div>
          )
        })}
      </div>

      <div className="grid gap-3 rounded-[var(--radius-lg)] bg-subtle p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-secondary">예상 결제 금액</span>
          <strong className="text-2xl font-bold text-primary">45,000원</strong>
        </div>
        <p className="m-0 text-xs text-secondary">
          취소 시점에 따라 70%, 50%, 0% 환불 기준이 적용돼요.
        </p>
      </div>

      <Link
        className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent px-5 py-3 text-sm font-bold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--accent-hover)] active:translate-y-px active:bg-[var(--accent-pressed)]"
        href="/lessons"
      >
        예약하기
      </Link>
    </aside>
  )
}
