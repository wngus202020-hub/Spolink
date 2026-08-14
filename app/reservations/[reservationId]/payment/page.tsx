import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  CreditCard,
  MapPin,
  ReceiptText,
  ShieldCheck,
} from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PublicHeader } from "@/components/layout/public-header"
import { PaymentPreparationForm } from "@/components/payments/payment-preparation-form"
import { StatusBadge } from "@/components/ui/status-badge"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import {
  type PaymentPageState,
  type PaymentPageViewModel,
  readPaymentPageData,
} from "@/lib/payments/payment-page-data"

type ReservationPaymentPageProps = Readonly<{
  params: Promise<{ reservationId: string }>
}>

type StatePresentation = Readonly<{
  badge: string
  description: string
  icon: typeof CircleAlert
  title: string
  tone: "neutral" | "success" | "warning"
}>

export const dynamic = "force-dynamic"
export const revalidate = 0

const paymentStatePresentation: Record<PaymentPageState, StatePresentation> = {
  confirmed: {
    badge: "결제 처리 상태",
    description: "이미 처리된 예약이에요. 이 화면에서는 추가 결제 요청을 준비할 수 없어요.",
    icon: CheckCircle2,
    title: "결제 처리가 끝난 예약이에요",
    tone: "success",
  },
  expired_pending: {
    badge: "준비 시간 만료",
    description:
      "결제 준비 가능 시간이 지나 이 예약에서는 결제 요청 정보를 만들 수 없어요. 레슨 일정을 다시 확인해요.",
    icon: Clock3,
    title: "결제 준비 시간이 지났어요",
    tone: "warning",
  },
  not_found: {
    badge: "예약 정보 없음",
    description:
      "요청한 예약을 찾지 못했어요. 주소가 정확한지 확인하고 내 예약 경로에서 다시 접근해요.",
    icon: CircleAlert,
    title: "예약 정보를 찾을 수 없어요",
    tone: "neutral",
  },
  pending_valid: {
    badge: "결제 준비 전",
    description:
      "아래 예약 정보를 확인한 뒤 결제 요청 준비 버튼을 누르면 돼요. 이 단계에서는 비용 청구나 예약 상태 변경이 일어나지 않아요.",
    icon: CreditCard,
    title: "결제 요청 정보를 준비해요",
    tone: "warning",
  },
  read_failure: {
    badge: "정보 확인 실패",
    description:
      "예약 정보를 불러오지 못했어요. 연결 상태를 확인한 뒤 잠시 후 페이지를 다시 열어 봐요.",
    icon: CircleAlert,
    title: "결제 정보를 확인하지 못했어요",
    tone: "warning",
  },
  ready: {
    badge: "요청 준비됨",
    description:
      "결제 요청 정보가 준비돼 있어요. 아직 결제 승인이나 예약 상태 변경은 이루어지지 않았어요.",
    icon: ShieldCheck,
    title: "준비된 결제 요청을 확인해요",
    tone: "warning",
  },
  terminal: {
    badge: "종료된 예약",
    description:
      "취소 또는 종료된 예약에서는 결제 요청 정보를 준비할 수 없어요. 현재 예약 상태를 다시 확인해요.",
    icon: CircleAlert,
    title: "결제를 준비할 수 없는 예약이에요",
    tone: "neutral",
  },
  unavailable: {
    badge: "결제 준비 불가",
    description:
      "현재 예약 또는 결제 상태에서는 요청 정보를 준비할 수 없어요. 잠시 후 예약 상태를 다시 확인해요.",
    icon: CircleAlert,
    title: "지금은 결제를 준비할 수 없어요",
    tone: "neutral",
  },
}

const expiryFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
})

export default async function ReservationPaymentPage({ params }: ReservationPaymentPageProps) {
  const [{ reservationId }, auth] = await Promise.all([params, readPageAuthProfile()])
  const nextPath = `/reservations/${reservationId}/payment`
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured") {
    redirect(`/auth/login?next=${nextPath}`)
  }
  if (auth.kind === "profile_required") {
    redirect("/onboarding/profile")
  }

  const paymentPageData = await readPaymentPageData(reservationId, auth.profile.id)
  const presentation = paymentStatePresentation[paymentPageData.state]

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />

      <section className="mx-auto grid w-full max-w-[1180px] gap-6 px-4 pb-14 pt-6 md:px-6">
        <Link
          className="inline-flex min-h-10 w-fit items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-canvas px-4 text-sm font-bold text-secondary hover:bg-inset"
          href="/lessons"
        >
          <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.8} />
          레슨 목록
        </Link>

        <PaymentStatePanel
          presentation={presentation}
          role={paymentPageData.state === "read_failure" ? "alert" : undefined}
        />

        {paymentPageData.viewModel ? (
          <PaymentDetails
            returnPath={nextPath}
            showPreparation={
              paymentPageData.state === "pending_valid" || paymentPageData.state === "ready"
            }
            viewModel={paymentPageData.viewModel}
          />
        ) : null}
      </section>
    </main>
  )
}

type PaymentStatePanelProps = Readonly<{
  presentation: StatePresentation
  role?: "alert" | undefined
}>

function PaymentStatePanel({ presentation, role }: PaymentStatePanelProps) {
  const Icon = presentation.icon

  return (
    <section
      className="grid gap-4 rounded-[var(--radius-xl)] border border-line bg-canvas p-5 [box-shadow:var(--shadow-panel)] md:p-6"
      role={role}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Icon aria-hidden="true" className="size-5 text-accent" strokeWidth={1.8} />
        <StatusBadge tone={presentation.tone}>{presentation.badge}</StatusBadge>
      </div>
      <div className="grid gap-3">
        <h1 className="m-0 text-pretty text-[30px] font-bold leading-[1.24] text-primary sm:text-[34px] md:text-5xl">
          {presentation.title}
        </h1>
        <p className="m-0 max-w-[68ch] text-pretty text-base leading-[1.7] text-secondary md:text-lg">
          {presentation.description}
        </p>
      </div>
    </section>
  )
}

type PaymentDetailsProps = Readonly<{
  returnPath: string
  showPreparation: boolean
  viewModel: PaymentPageViewModel
}>

function PaymentDetails({ returnPath, showPreparation, viewModel }: PaymentDetailsProps) {
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
