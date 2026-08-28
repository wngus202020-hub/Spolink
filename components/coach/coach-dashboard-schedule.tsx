import { CalendarDays, Users } from "lucide-react"
import { StatusBadge } from "@/components/ui/status-badge"
import type { CoachDashboard } from "@/lib/coach/dashboard-read-model"
import { EmptyState, SectionHeading } from "./coach-dashboard-overview"

type Props = Readonly<{ schedules: CoachDashboard["todaySchedules"] }>

const timeFormatter = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  timeZone: "Asia/Seoul",
})

export function CoachDashboardSchedule({ schedules }: Props) {
  return (
    <section
      aria-labelledby="today-schedule-heading"
      className="grid min-w-0 content-start gap-3 lg:col-span-2"
    >
      <div className="flex items-center gap-2">
        <CalendarDays aria-hidden="true" className="size-5 text-accent" />
        <SectionHeading id="today-schedule-heading">오늘 일정</SectionHeading>
      </div>
      {schedules.length === 0 ? (
        <EmptyState>오늘 예정된 일정이 없습니다.</EmptyState>
      ) : (
        <ol className="m-0 grid list-none divide-y divide-line rounded-[var(--radius-lg)] border border-line p-0">
          {schedules.map((schedule) => (
            <li
              className="grid min-w-0 gap-3 px-4 py-5 sm:grid-cols-6 sm:items-center"
              key={`${schedule.startsAt}-${schedule.lessonTitle}`}
            >
              <time className="text-sm font-bold tabular-nums text-primary sm:col-span-2">
                {formatTime(schedule.startsAt)} - {formatTime(schedule.endsAt)}
              </time>
              <div className="grid min-w-0 gap-1 sm:col-span-3">
                <strong className="break-words text-sm text-primary">{schedule.lessonTitle}</strong>
                <span className="flex items-center gap-1.5 text-xs text-secondary">
                  <Users aria-hidden="true" className="size-3.5 shrink-0" />
                  {schedule.reservedCount} / {schedule.capacity}명
                </span>
              </div>
              <StatusBadge tone={schedule.isOpen ? "success" : "neutral"}>
                {schedule.isOpen ? "모집 중" : "마감"}
              </StatusBadge>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function formatTime(value: string) {
  return timeFormatter.format(new Date(value))
}
