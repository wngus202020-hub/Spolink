import Link from "next/link"
import { notFound } from "next/navigation"

import { PublicHeader } from "@/components/layout/public-header"
import { CoachLessonForm } from "@/components/lessons/coach-lesson-form"
import { LessonStatusBadge } from "@/components/lessons/lesson-status-badge"
import { readApprovedCoachPage } from "@/lib/lessons/coach-authoring-page"
import { getSupabasePublicStorageUrl } from "@/lib/supabase/public-read-client"

export const dynamic = "force-dynamic"
export const revalidate = 0

type EditCoachLessonPageProps = Readonly<{
  params: Promise<Readonly<{ lessonId: string }>>
}>

export default async function EditCoachLessonPage({ params }: EditCoachLessonPageProps) {
  const { lessonId } = await params
  const { auth, supabase } = await readApprovedCoachPage(`/coach/lessons/${lessonId}/edit`)
  const [
    { data: lesson, error },
    { data: sports, error: sportsError },
    { data: lessonImages, error: lessonImagesError },
  ] = await Promise.all([
    supabase
      .from("lessons")
      .select("*")
      .eq("id", lessonId)
      .eq("coach_profile_id", auth.coachProfile.id)
      .maybeSingle(),
    supabase
      .from("sports")
      .select("id,name")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("lesson_images")
      .select("id,file_path,lifecycle_state,sort_order")
      .eq("lesson_id", lessonId)
      .in("lifecycle_state", ["ready", "deleting"])
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
  ])
  if (error || sportsError || lessonImagesError) {
    throw new CoachLessonEditError("Unable to read lesson draft", {
      cause: error ?? sportsError ?? lessonImagesError,
    })
  }
  if (!lesson) notFound()

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />
      <section className="mx-auto grid w-full max-w-[880px] gap-8 px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <header className="grid gap-3 border-b border-line pb-6">
          <Link
            className="w-fit text-sm font-bold text-secondary hover:text-primary"
            href="/coach/lessons"
          >
            내 레슨으로
          </Link>
          <LessonStatusBadge status={lesson.status} />
          <h1 className="m-0 text-[34px] font-bold leading-[1.18] text-primary md:text-4xl">
            레슨 상세·수정
          </h1>
          {lesson.status === "pending_review" || lesson.status === "closed" ? (
            <p className="m-0 break-keep text-sm leading-6 text-secondary">
              현재 상태에서는 내용을 수정할 수 없습니다. 검토 결과 또는 운영 상태를 확인해 주세요.
            </p>
          ) : null}
        </header>
        <CoachLessonForm
          initial={{
            address: lesson.address,
            cancellationPolicySummary: lesson.cancellation_policy_summary,
            capacity: lesson.capacity,
            description: lesson.description,
            durationMinutes: lesson.duration_minutes,
            id: lesson.id,
            latitude: lesson.latitude,
            longitude: lesson.longitude,
            placeName: lesson.place_name,
            preparation: lesson.preparation,
            priceAmount: lesson.price_amount,
            region: lesson.region,
            sportId: lesson.sport_id,
            status: lesson.status,
            summary: lesson.summary,
            title: lesson.title,
            updatedAt: lesson.updated_at,
          }}
          initialImages={(lessonImages ?? []).map((image) => ({
            id: image.id,
            lifecycleState: image.lifecycle_state,
            objectName: image.file_path,
            previewUrl: lessonImageUrl(image.file_path),
          }))}
          sports={sports ?? []}
        />
      </section>
    </main>
  )
}

class CoachLessonEditError extends Error {
  readonly name = "CoachLessonEditError"
}

function lessonImageUrl(objectName: string) {
  const url = getSupabasePublicStorageUrl(objectName)
  if (!url) throw new CoachLessonEditError("Unable to create lesson image URL")
  return url
}
