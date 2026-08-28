import Link from "next/link"
import { notFound } from "next/navigation"

import { PublicHeader } from "@/components/layout/public-header"
import { CoachScheduleManager } from "@/components/lessons/coach-schedule-manager"
import { LessonStatusBadge } from "@/components/lessons/lesson-status-badge"
import { readApprovedCoachPage } from "@/lib/lessons/coach-authoring-page"

export const dynamic = "force-dynamic"
export const revalidate = 0

type CoachSchedulesPageProps = Readonly<{
  params: Promise<Readonly<{ lessonId: string }>>
}>

export default async function CoachSchedulesPage({ params }: CoachSchedulesPageProps) {
  const { lessonId } = await params
  const { auth, supabase } = await readApprovedCoachPage(`/coach/lessons/${lessonId}/schedules`)
  const { data: lesson, error } = await supabase
    .from("lessons")
    .select("id,title,status")
    .eq("id", lessonId)
    .eq("coach_profile_id", auth.coachProfile.id)
    .maybeSingle()
  if (error) throw new CoachSchedulesReadError("Unable to read lesson", { cause: error })
  if (!lesson) notFound()

  const { data: schedules, error: scheduleError } = await supabase
    .from("lesson_schedules")
    .select("id,lesson_id,starts_at,ends_at,capacity,reserved_count,is_open,updated_at")
    .eq("lesson_id", lesson.id)
    .order("starts_at", { ascending: true })
  if (scheduleError) {
    throw new CoachSchedulesReadError("Unable to read lesson schedules", {
      cause: scheduleError,
    })
  }

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />
      <section className="mx-auto grid w-full max-w-[960px] gap-8 px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <header className="grid gap-3 border-b border-line pb-6">
          <Link
            className="w-fit text-sm font-bold text-secondary hover:text-primary"
            href="/coach/lessons"
          >
            내 레슨으로
          </Link>
          <LessonStatusBadge status={lesson.status} />
          <h1 className="m-0 text-[34px] font-bold leading-[1.18] text-primary md:text-4xl">
            일정 관리
          </h1>
          <p className="m-0 break-keep text-base leading-7 text-secondary">{lesson.title}</p>
        </header>
        <CoachScheduleManager
          canMutate={lesson.status !== "closed" && lesson.status !== "pending_review"}
          lessonId={lesson.id}
          schedules={(schedules ?? []).map((schedule) => ({
            capacity: schedule.capacity,
            endsAt: schedule.ends_at,
            id: schedule.id,
            isOpen: schedule.is_open,
            lessonId: schedule.lesson_id,
            reservedCount: schedule.reserved_count,
            startsAt: schedule.starts_at,
            updatedAt: schedule.updated_at,
          }))}
        />
      </section>
    </main>
  )
}

class CoachSchedulesReadError extends Error {
  readonly name = "CoachSchedulesReadError"
}
