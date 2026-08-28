import { ClipboardCheck } from "lucide-react"
import { redirect } from "next/navigation"

import { AdminLessonReviewActions } from "@/components/admin/admin-lesson-review-actions"
import { PublicHeader } from "@/components/layout/public-header"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  createSupabaseServerComponentClient,
  readServerAuthProfile,
} from "@/lib/auth/server-profile"

export const dynamic = "force-dynamic"
export const fetchCache = "force-no-store"
export const revalidate = 0

export default async function AdminLessonsPage() {
  const auth = await readServerAuthProfile()
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured")
    redirect("/auth/login?next=/admin/lessons")
  if (auth.kind === "profile_required") redirect("/onboarding/profile")
  if (auth.kind === "account_deleted") redirect("/auth/restricted?reason=account-deleted")
  if (auth.kind === "account_suspended") redirect("/auth/restricted?reason=account-suspended")
  if (auth.profile.role !== "admin" || auth.profile.status !== "active") redirect("/mypage")
  const supabase = await createSupabaseServerComponentClient()
  const { data, error } = await supabase
    .from("lessons")
    .select(
      "id,title,summary,description,region,price_amount,duration_minutes,capacity,status,updated_at",
    )
    .eq("status", "pending_review")
    .order("updated_at")
  if (error) throw new AdminLessonReadError()
  const lessons = data ?? []
  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />
      <section className="mx-auto grid w-full max-w-[1180px] gap-7 px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid gap-3">
            <StatusBadge tone="warning">관리자 검토</StatusBadge>
            <h1 className="m-0 text-[34px] font-bold leading-[1.18] text-primary md:text-5xl">
              레슨 승인 대기
            </h1>
            <p className="m-0 break-keep text-base text-secondary">
              지도자가 제출한 레슨 정보만 검토하고 승인 또는 반려해요.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 text-sm font-bold text-secondary">
            <ClipboardCheck aria-hidden="true" className="size-5 text-accent" />총 {lessons.length}
            건
          </span>
        </header>
        {lessons.length === 0 ? (
          <div className="grid min-h-56 place-items-center rounded-[var(--radius-xl)] border border-dashed border-line bg-subtle p-6 text-center">
            <div className="grid gap-2">
              <strong className="text-primary">검토 대기 레슨이 없습니다</strong>
              <span className="text-sm text-secondary">새 제출이 들어오면 이곳에 표시됩니다.</span>
            </div>
          </div>
        ) : (
          <ul className="m-0 grid list-none gap-4 p-0">
            {lessons.map((lesson) => (
              <li
                className="grid gap-5 rounded-[var(--radius-xl)] border border-line bg-canvas p-5 md:grid-cols-[minmax(0,1fr)_300px] md:p-6"
                key={lesson.id}
              >
                <div className="grid gap-3">
                  <h2 className="m-0 text-2xl font-bold text-primary">{lesson.title}</h2>
                  <p className="m-0 break-keep text-sm leading-[1.7] text-secondary">
                    {lesson.summary ?? lesson.description}
                  </p>
                  <dl className="m-0 grid grid-cols-2 gap-3 text-sm">
                    <Info label="지역" value={lesson.region} />
                    <Info label="가격" value={`${lesson.price_amount.toLocaleString("ko-KR")}원`} />
                    <Info label="시간" value={`${lesson.duration_minutes}분`} />
                    <Info label="정원" value={`${lesson.capacity}명`} />
                  </dl>
                </div>
                <AdminLessonReviewActions lessonId={lesson.id} updatedAt={lesson.updated_at} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function Info({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-bold text-secondary">{label}</dt>
      <dd className="m-0 font-bold text-primary">{value}</dd>
    </div>
  )
}
class AdminLessonReadError extends Error {
  readonly name = "AdminLessonReadError"
}
