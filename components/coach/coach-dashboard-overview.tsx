import type { LucideIcon } from "lucide-react"
import {
  ArrowRight,
  CalendarCheck,
  CalendarPlus,
  CircleDollarSign,
  Clock3,
  ListChecks,
  NotebookTabs,
} from "lucide-react"
import Link from "next/link"

import type { CoachDashboard } from "@/lib/coach/dashboard-read-model"

type Props = Readonly<{ dashboard: CoachDashboard }>

export function CoachDashboardOverview({ dashboard }: Props) {
  const metrics = [
    {
      icon: Clock3,
      label: "결제 대기",
      value: `${formatCount(dashboard.reservations.pendingPayment)}건`,
    },
    {
      icon: CalendarCheck,
      label: "예약 확정",
      value: `${formatCount(dashboard.reservations.confirmed)}건`,
    },
    {
      icon: ListChecks,
      label: "완료 처리 대기",
      value: `${formatCount(dashboard.reservations.completionPending)}건`,
    },
    {
      icon: CircleDollarSign,
      label: "정산 예정",
      value: formatWon(dashboard.pendingSettlements.totalNetAmount),
    },
  ] satisfies readonly Metric[]

  return (
    <div className="grid min-w-0 gap-8">
      <section aria-labelledby="dashboard-summary-heading" className="grid gap-3">
        <SectionHeading id="dashboard-summary-heading">운영 요약</SectionHeading>
        <ul className="m-0 grid list-none gap-px overflow-hidden rounded-[var(--radius-lg)] border border-line bg-line p-0 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map(({ icon: Icon, label, value }) => (
            <li className="grid min-h-28 min-w-0 content-between gap-4 bg-canvas p-5" key={label}>
              <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-secondary">
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                <span className="break-keep">{label}</span>
              </span>
              <strong className="break-words text-2xl font-bold text-primary">{value}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="processing-heading" className="grid gap-3">
        <SectionHeading id="processing-heading">처리할 예약</SectionHeading>
        {dashboard.reservations.pendingPayment === 0 &&
        dashboard.reservations.completionPending === 0 ? (
          <EmptyState>처리할 예약이 없습니다.</EmptyState>
        ) : (
          <ul className="m-0 grid list-none divide-y divide-line rounded-[var(--radius-lg)] border border-line p-0 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <ProcessingLink
              count={dashboard.reservations.pendingPayment}
              href="/coach/reservations?status=pending_payment"
              label="결제 대기 예약 확인"
            />
            <ProcessingLink
              count={dashboard.reservations.completionPending}
              href="/coach/reservations?status=confirmed"
              label="완료 처리 대기 확인"
            />
          </ul>
        )}
      </section>

      <QuickActions />
    </div>
  )
}

function QuickActions() {
  const actions = [
    { href: "/coach/lessons/new", icon: CalendarPlus, label: "새 레슨 등록" },
    { href: "/coach/lessons", icon: NotebookTabs, label: "레슨 일정 관리" },
    { href: "/coach/reservations", icon: ListChecks, label: "예약 관리" },
    { href: "/coach/settlements", icon: CircleDollarSign, label: "정산 관리" },
  ] satisfies readonly Action[]

  return (
    <section aria-labelledby="quick-actions-heading" className="grid gap-3">
      <SectionHeading id="quick-actions-heading">빠른 실행</SectionHeading>
      <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {actions.map(({ href, icon: Icon, label }) => (
          <li className="min-w-0" key={href}>
            <Link
              className="flex min-h-12 min-w-0 items-center gap-3 rounded-[var(--radius-md)] border border-line px-4 py-3 text-sm font-bold text-primary hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              href={href}
            >
              <Icon aria-hidden="true" className="size-4 shrink-0 text-accent" />
              <span className="min-w-0 break-keep">{label}</span>
              <ArrowRight aria-hidden="true" className="ml-auto size-4 shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ProcessingLink({
  count,
  href,
  label,
}: Readonly<{ count: number; href: string; label: string }>) {
  return (
    <li className="min-w-0">
      <Link className="flex min-h-20 items-center gap-3 p-4 hover:bg-subtle" href={href}>
        <span className="min-w-0 flex-1 break-keep text-sm font-bold text-primary">{label}</span>
        <strong className="shrink-0 text-lg text-primary">{formatCount(count)}건</strong>
        <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-secondary" />
      </Link>
    </li>
  )
}

export function SectionHeading({ children, id }: Readonly<{ children: string; id: string }>) {
  return (
    <h2 className="m-0 text-lg font-bold text-primary" id={id}>
      {children}
    </h2>
  )
}

export function EmptyState({ children }: Readonly<{ children: string }>) {
  return (
    <p className="m-0 rounded-[var(--radius-lg)] border border-line px-4 py-6 text-sm text-secondary">
      {children}
    </p>
  )
}

type Metric = Readonly<{ icon: LucideIcon; label: string; value: string }>
type Action = Readonly<{ href: string; icon: LucideIcon; label: string }>

function formatCount(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value)
}

function formatWon(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`
}
