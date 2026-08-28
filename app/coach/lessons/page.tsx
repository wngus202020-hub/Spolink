import { CalendarDays, FilePlus2, PencilLine } from "lucide-react"
import Link from "next/link"

import { PublicHeader } from "@/components/layout/public-header"
import { LessonStatusBadge } from "@/components/lessons/lesson-status-badge"
import { readApprovedCoachPage } from "@/lib/lessons/coach-authoring-page"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function CoachLessonsPage() {
  const { auth, supabase } = await readApprovedCoachPage("/coach/lessons")
  const { data: lessons, error } = await supabase
    .from("lessons")
    .select("id,title,status,price_amount,duration_minutes,capacity,updated_at")
    .eq("coach_profile_id", auth.coachProfile.id)
    .order("updated_at", { ascending: false })

  if (error) throw new CoachLessonsReadError("Unable to read coach lessons", { cause: error })

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />
      <section className="mx-auto grid w-full max-w-[1120px] gap-8 px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
          <div className="grid gap-2">
            <h1 className="m-0 text-[34px] font-bold leading-[1.18] text-primary md:text-4xl">
              내 레슨
            </h1>
            <p className="m-0 break-keep text-base leading-7 text-secondary">
              초안을 저장하고 검토 상태와 예약 일정을 관리해요.
            </p>
          </div>
          <Link
            className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-md)] bg-accent px-5 py-3 text-sm font-bold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]"
            href="/coach/lessons/new"
          >
            <FilePlus2 aria-hidden="true" className="size-4" />새 레슨
          </Link>
        </header>

        {lessons?.length ? (
          <ul className="m-0 grid list-none gap-0 p-0">
            {lessons.map((lesson) => (
              <li
                className="grid gap-4 border-b border-line py-6 md:grid-cols-[1fr_auto]"
                key={lesson.id}
              >
                <div className="min-w-0 grid gap-3">
                  <LessonStatusBadge status={lesson.status} />
                  <div>
                    <h2 className="m-0 truncate text-xl font-bold text-primary">{lesson.title}</h2>
                    <p className="m-0 mt-1 text-sm text-secondary">
                      {lesson.duration_minutes}분 · 정원 {lesson.capacity}명 ·{" "}
                      {lesson.price_amount.toLocaleString("ko-KR")}원
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  <Link
                    className={secondaryLinkClassName}
                    href={`/coach/lessons/${lesson.id}/edit`}
                  >
                    <PencilLine aria-hidden="true" className="size-4" />
                    상세·수정
                  </Link>
                  <Link
                    className={secondaryLinkClassName}
                    href={`/coach/lessons/${lesson.id}/schedules`}
                  >
                    <CalendarDays aria-hidden="true" className="size-4" />
                    일정 관리
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <section className="grid justify-items-start gap-3 rounded-[var(--radius-lg)] bg-subtle p-6">
            <h2 className="m-0 text-xl font-bold text-primary">아직 등록한 레슨이 없습니다.</h2>
            <p className="m-0 text-sm leading-6 text-secondary">
              첫 레슨을 임시 저장한 뒤 검토를 요청해 주세요.
            </p>
            <Link className={secondaryLinkClassName} href="/coach/lessons/new">
              첫 레슨 등록
            </Link>
          </section>
        )}
      </section>
    </main>
  )
}

const secondaryLinkClassName =
  "inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-md)] border border-line bg-canvas px-4 py-2 text-sm font-bold text-primary hover:bg-inset"

class CoachLessonsReadError extends Error {
  readonly name = "CoachLessonsReadError"
}
