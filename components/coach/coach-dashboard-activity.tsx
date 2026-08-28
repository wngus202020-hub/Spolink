import { Bell, CircleDollarSign, Star } from "lucide-react"
import Link from "next/link"

import type { CoachDashboard } from "@/lib/coach/dashboard-read-model"
import { EmptyState, SectionHeading } from "./coach-dashboard-overview"

type Props = Readonly<{ dashboard: CoachDashboard }>

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeZone: "Asia/Seoul",
})

export function CoachDashboardActivity({ dashboard }: Props) {
  return (
    <div className="grid min-w-0 content-start gap-8">
      <section aria-labelledby="settlement-heading" className="grid gap-3">
        <div className="flex items-center gap-2">
          <CircleDollarSign aria-hidden="true" className="size-5 text-accent" />
          <SectionHeading id="settlement-heading">정산 예정</SectionHeading>
        </div>
        {dashboard.pendingSettlements.count === 0 ? (
          <EmptyState>정산 예정 내역이 없습니다.</EmptyState>
        ) : (
          <Link
            className="grid min-w-0 gap-1 rounded-[var(--radius-lg)] border border-line px-4 py-5 hover:bg-subtle"
            href="/coach/settlements"
          >
            <strong className="break-words text-2xl text-primary">
              {formatWon(dashboard.pendingSettlements.totalNetAmount)}
            </strong>
            <span className="text-sm text-secondary">
              지급 대기 {formatCount(dashboard.pendingSettlements.count)}건
            </span>
          </Link>
        )}
      </section>

      <section aria-labelledby="reviews-heading" className="grid gap-3">
        <SectionHeading id="reviews-heading">최근 리뷰</SectionHeading>
        {dashboard.recentReviews.length === 0 ? (
          <EmptyState>아직 등록된 리뷰가 없습니다.</EmptyState>
        ) : (
          <ul className="m-0 grid list-none divide-y divide-line rounded-[var(--radius-lg)] border border-line p-0">
            {dashboard.recentReviews.map((review) => (
              <li
                className="grid min-w-0 gap-2 px-4 py-5"
                key={`${review.createdAt}-${review.lessonTitle}`}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <strong className="min-w-0 break-words text-sm text-primary">
                    {review.lessonTitle}
                  </strong>
                  <span className="flex items-center gap-1 text-xs font-bold text-secondary">
                    <Star aria-hidden="true" className="size-3.5 fill-current" />
                    {review.rating}
                  </span>
                </div>
                <p className="m-0 break-words text-sm leading-relaxed text-secondary">
                  {review.content ?? "내용 없이 평점만 남긴 리뷰입니다."}
                </p>
                <time className="text-xs text-tertiary">{formatDate(review.createdAt)}</time>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="notifications-heading" className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <Bell aria-hidden="true" className="size-5 shrink-0 text-accent" />
            <SectionHeading id="notifications-heading">읽지 않은 알림</SectionHeading>
          </span>
          <strong className="shrink-0 text-sm text-primary">
            {formatCount(dashboard.notifications.unreadCount)}건
          </strong>
        </div>
        {dashboard.notifications.items.length === 0 ? (
          <EmptyState>읽지 않은 알림이 없습니다.</EmptyState>
        ) : (
          <ul className="m-0 grid list-none divide-y divide-line rounded-[var(--radius-lg)] border border-line p-0">
            {dashboard.notifications.items.map((notification) => (
              <li
                className="grid min-w-0 gap-1 px-4 py-5"
                key={`${notification.createdAt}-${notification.title}`}
              >
                <strong className="break-words text-sm text-primary">{notification.title}</strong>
                {notification.body ? (
                  <p className="m-0 break-words text-sm leading-relaxed text-secondary">
                    {notification.body}
                  </p>
                ) : null}
                <time className="text-xs text-tertiary">{formatDate(notification.createdAt)}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function formatCount(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value)
}

function formatWon(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(value))
}
