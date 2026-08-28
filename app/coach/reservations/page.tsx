import { CalendarDays, CircleAlert } from "lucide-react"
import { CoachReservationActions } from "@/components/coach/coach-reservation-actions"
import { PublicHeader } from "@/components/layout/public-header"
import { LessonStatusBadge } from "@/components/lessons/lesson-status-badge"
import { readApprovedCoachPage } from "@/lib/lessons/coach-authoring-page"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function CoachReservationsPage() {
  const { auth, supabase } = await readApprovedCoachPage("/coach/reservations")
  const result = await supabase
    .from("reservations")
    .select("id,status,lesson_id,lesson_schedule_id,reserved_price_amount,learner_id")
    .eq("coach_profile_id", auth.coachProfile.id)
    .order("created_at", { ascending: false })
  if (result.error) throw new Error("Coach reservations could not be read")
  const rows = result.data ?? []
  const [lessons, schedules, learners] = await Promise.all([
    supabase
      .from("lessons")
      .select("id,title,status")
      .in("id", [...new Set(rows.map((row) => row.lesson_id))]),
    supabase
      .from("lesson_schedules")
      .select("id,starts_at,ends_at")
      .in("id", [...new Set(rows.map((row) => row.lesson_schedule_id))]),
    supabase
      .from("profiles")
      .select("id,display_name")
      .in("id", [...new Set(rows.map((row) => row.learner_id))]),
  ])
  if (lessons.error || schedules.error || learners.error)
    throw new Error("Coach reservation details could not be read")
  const lessonMap = new Map((lessons.data ?? []).map((lesson) => [lesson.id, lesson]))
  const scheduleMap = new Map((schedules.data ?? []).map((schedule) => [schedule.id, schedule]))
  const learnerMap = new Map(
    (learners.data ?? []).map((learner) => [learner.id, learner.display_name]),
  )
  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />
      <section className="mx-auto grid w-full max-w-[1120px] gap-7 px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <header className="grid gap-3 border-b border-line pb-6">
          <CalendarDays aria-hidden="true" className="size-8 text-accent" />
          <h1 className="m-0 text-[34px] font-bold leading-tight text-primary md:text-4xl">
            예약 운영
          </h1>
          <p className="m-0 text-base leading-7 text-secondary">
            수업 일정과 예약 상태를 확인하고 완료 또는 노쇼를 처리해요.
          </p>
        </header>
        {rows.length === 0 ? (
          <section className="grid gap-2 rounded-[var(--radius-lg)] bg-subtle p-6">
            <h2 className="m-0 text-xl font-bold text-primary">처리할 예약이 없어요.</h2>
            <p className="m-0 text-sm text-secondary">
              확정된 수업이 생기면 이곳에서 확인할 수 있어요.
            </p>
          </section>
        ) : (
          <ul className="m-0 grid list-none gap-4 p-0">
            {rows.map((row) => {
              const lesson = lessonMap.get(row.lesson_id)
              const schedule = scheduleMap.get(row.lesson_schedule_id)
              const actionable = row.status === "confirmed"
              return (
                <li
                  className="grid gap-4 rounded-[var(--radius-lg)] border border-line bg-canvas p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                  key={row.id}
                >
                  <div className="grid min-w-0 gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <LessonStatusBadge status={lesson?.status ?? "closed"} />
                      <span className="text-sm font-bold text-secondary">
                        예약 상태: {row.status}
                      </span>
                    </div>
                    <h2 className="m-0 truncate text-xl font-bold text-primary">
                      {lesson?.title ?? "레슨 정보 없음"}
                    </h2>
                    <p className="m-0 text-sm text-secondary">
                      학습자 {learnerMap.get(row.learner_id) ?? "정보 없음"} ·{" "}
                      {schedule
                        ? formatSchedule(schedule.starts_at, schedule.ends_at)
                        : "일정 정보 없음"}
                    </p>
                    <p className="m-0 text-sm font-bold text-primary">
                      {row.reserved_price_amount.toLocaleString("ko-KR")}원
                    </p>
                  </div>
                  {actionable ? (
                    <CoachReservationActions reservationId={row.id} />
                  ) : (
                    <span className="inline-flex items-center gap-2 text-sm text-secondary">
                      <CircleAlert aria-hidden="true" className="size-4" />
                      처리된 예약
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </main>
  )
}

function formatSchedule(startsAt: string, endsAt: string) {
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  })
  return `${formatter.format(new Date(startsAt))} - ${formatter.format(new Date(endsAt))}`
}
