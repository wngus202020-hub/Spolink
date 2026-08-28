import { CalendarDays, Clock3, MapPin, ReceiptText, ShieldCheck } from "lucide-react"
import { PaymentPreparationForm } from "@/components/payments/payment-preparation-form"
import type { PaymentPageViewModel } from "@/lib/payments/payment-page-data"

const expiryFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
})

type PaymentDetailsProps = Readonly<{
  returnPath: string
  showPreparation: boolean
  viewModel: PaymentPageViewModel
}>

export function PaymentDetails({ returnPath, showPreparation, viewModel }: PaymentDetailsProps) {
  const expiryText = formatExpiry(viewModel.paymentExpiresAt)
  const placeText = formatPlace(viewModel.region, viewModel.place)
  const amountText = `${viewModel.amount.toLocaleString("ko-KR")}원`

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      <div className="grid gap-5">
        <section className="grid gap-5 rounded-[var(--radius-xl)] border border-line bg-canvas p-5">
          <div className="grid gap-2">
            <span className="text-sm font-bold text-accent">예약 레슨</span>
            <h2 className="m-0 text-pretty text-[26px] font-bold leading-[1.28] text-primary">
              {viewModel.lesson.title}
            </h2>
          </div>

          <dl className="m-0 grid gap-4 md:grid-cols-2">
            <DetailItem
              icon={CalendarDays}
              label="레슨 일정"
              value={viewModel.schedule.label ?? "일정 정보 확인 필요"}
            />
            <DetailItem icon={MapPin} label="장소" value={placeText} />
            <DetailItem icon={Clock3} label="결제 준비 기한" value={expiryText} />
            <DetailItem icon={ReceiptText} label="예약 금액" value={amountText} />
          </dl>
        </section>

        <section className="grid gap-3 rounded-[var(--radius-xl)] border border-line bg-subtle p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck aria-hidden="true" className="size-5 text-accent" strokeWidth={1.8} />
            <h2 className="m-0 text-[22px] font-bold leading-[1.36] text-primary">환불 기준</h2>
          </div>
          <p className="m-0 text-pretty text-sm leading-[1.65] text-secondary">
            {viewModel.refundSummary ??
              "레슨 환불 기준을 확인하지 못했어요. 결제 진행 전에 문의해요."}
          </p>
        </section>
      </div>

      <aside className="grid h-fit gap-5 rounded-[var(--radius-xl)] border border-line bg-canvas p-6 [box-shadow:var(--shadow-panel)] lg:sticky lg:top-6">
        <div className="grid gap-1">
          <span className="text-sm text-secondary">결제 예정 금액</span>
          <strong className="text-3xl font-bold text-primary">{amountText}</strong>
          <span className="text-sm leading-[1.6] text-secondary">
            예약 시점에 저장된 금액이에요.
          </span>
        </div>

        <div className="grid gap-3 border-t border-line pt-4 text-sm text-secondary">
          <PriceRow label="레슨 금액" value={amountText} />
          <PriceRow label="플랫폼 수수료" value="포함" />
          <PriceRow isTotal={true} label="총 결제 예정" value={amountText} />
        </div>

        {showPreparation ? (
          <PaymentPreparationForm
            initialPayment={viewModel.readyPayment}
            reservationId={viewModel.reservation.id}
            returnPath={returnPath}
          />
        ) : (
          <p className="m-0 rounded-[var(--radius-md)] bg-inset px-4 py-3 text-sm leading-[1.6] text-secondary">
            현재 상태에서는 결제 요청을 준비할 수 없어요.
          </p>
        )}
      </aside>
    </div>
  )
}

type DetailItemProps = Readonly<{
  icon: typeof CalendarDays
  label: string
  value: string
}>

function DetailItem({ icon: Icon, label, value }: DetailItemProps) {
  return (
    <div className="grid min-w-0 gap-2 border-t border-line pt-4">
      <dt className="inline-flex items-center gap-2 text-sm font-bold text-primary">
        <Icon aria-hidden="true" className="size-4 shrink-0 text-accent" strokeWidth={1.8} />
        {label}
      </dt>
      <dd className="m-0 text-pretty text-sm leading-[1.6] text-secondary">{value}</dd>
    </div>
  )
}

type PriceRowProps = Readonly<{
  isTotal?: boolean
  label: string
  value: string
}>

function PriceRow({ isTotal = false, label, value }: PriceRowProps) {
  return (
    <span
      className={[
        "flex items-center justify-between gap-3",
        isTotal ? "text-base font-bold text-primary" : "",
      ].join(" ")}
    >
      <span>{label}</span>
      <strong className={isTotal ? "text-xl text-primary" : "text-primary"}>{value}</strong>
    </span>
  )
}

function formatExpiry(value: string | null) {
  if (!value) return "기한 정보 확인 필요"
  const date = new Date(value)

  return Number.isFinite(date.getTime()) ? expiryFormatter.format(date) : "기한 정보 확인 필요"
}

function formatPlace(region: string | null, place: string | null) {
  if (region && place) return `${region} · ${place}`
  return region ?? place ?? "장소 정보 확인 필요"
}
