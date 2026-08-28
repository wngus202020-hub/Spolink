import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Flag,
  MapPin,
  ShieldCheck,
  Star,
  Trophy,
} from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { LessonFavoriteControl } from "@/components/favorites/lesson-favorite-control"
import { PublicHeader } from "@/components/layout/public-header"
import { LessonBookingPanel } from "@/components/lessons/lesson-booking-panel"
import { LessonDetailGallery } from "@/components/lessons/lesson-detail-gallery"
import { StatusBadge } from "@/components/ui/status-badge"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import {
  getActiveLessonByIdForDisplay,
  getActiveLessonsForDisplay,
} from "@/lib/lessons/display-lessons"

type LessonDetailPageProps = Readonly<{
  params: Promise<{ lessonId: string }>
}>

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateStaticParams() {
  const lessons = await getActiveLessonsForDisplay()

  return lessons.map((lesson) => ({ lessonId: lesson.id }))
}

export default async function LessonDetailPage({ params }: LessonDetailPageProps) {
  const { lessonId } = await params
  const [auth, lesson] = await Promise.all([
    readPageAuthProfile(),
    getActiveLessonByIdForDisplay(lessonId),
  ])

  if (!lesson) {
    notFound()
  }

  const lessonImages =
    lesson.media.kind === "photo"
      ? (lesson.media.images ?? [{ sortOrder: 0, url: lesson.media.src }])
      : []

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />

      <section className="mx-auto grid w-full max-w-[1280px] gap-8 px-4 pb-14 pt-6 md:px-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="grid gap-8">
          <Link
            className="inline-flex min-h-10 w-fit items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-canvas px-4 text-sm font-bold text-secondary hover:bg-inset"
            href="/lessons"
          >
            <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.8} />
            레슨 목록
          </Link>

          <div className="grid gap-5">
            <LessonDetailGallery images={lessonImages} title={lesson.title} />

            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="success">인증 지도자 공개 레슨</StatusBadge>
                <span className="rounded-[var(--radius-pill)] border border-line bg-canvas px-3 py-1 text-sm font-bold text-secondary">
                  {lesson.sport}
                </span>
              </div>

              <div className="grid gap-3">
                <h1 className="m-0 text-balance text-[34px] font-bold leading-[1.18] text-primary md:text-5xl md:leading-[1.14]">
                  {lesson.title}
                </h1>
                <p className="m-0 max-w-[68ch] text-base leading-[1.7] text-secondary md:text-lg">
                  {lesson.summary}
                </p>
              </div>
            </div>
          </div>

          <section className="grid gap-4">
            <h2 className="m-0 text-[26px] font-bold leading-[1.32] text-primary">수업 정보</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { icon: MapPin, label: "장소", value: lesson.venueText },
                { icon: Clock, label: "시간", value: lesson.durationText },
                { icon: Trophy, label: "준비물", value: lesson.preparationText },
              ].map((item) => {
                const Icon = item.icon

                return (
                  <div
                    className="grid gap-2 rounded-[var(--radius-lg)] border border-line bg-canvas p-4"
                    key={item.label}
                  >
                    <Icon aria-hidden="true" className="size-5 text-accent" strokeWidth={1.8} />
                    <span className="text-sm font-bold text-primary">{item.label}</span>
                    <span className="text-sm leading-[1.55] text-secondary">{item.value}</span>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="grid gap-4 rounded-[var(--radius-lg)] border border-line bg-canvas p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="grid gap-2">
                <span className="inline-flex w-fit items-center gap-2 rounded-[var(--radius-pill)] bg-accent-soft px-3 py-1 text-sm font-bold text-primary">
                  <ShieldCheck
                    aria-hidden="true"
                    className="size-4 text-accent"
                    strokeWidth={1.8}
                  />
                  지도자 인증
                </span>
                <h2 className="m-0 text-[26px] font-bold leading-[1.32] text-primary">
                  {lesson.coachName}
                </h2>
              </div>
              <span className="text-sm font-bold text-secondary">{lesson.coachExperienceText}</span>
            </div>
            <p className="m-0 leading-[1.7] text-secondary">{lesson.coachProfileText}</p>
          </section>

          <section className="grid gap-4">
            <h2 className="m-0 text-[26px] font-bold leading-[1.32] text-primary">수업 구성</h2>
            <div className="grid gap-3">
              {lesson.detailBullets.map((item) => (
                <div
                  className="flex min-h-14 items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-canvas p-4"
                  key={item}
                >
                  <CheckCircle2
                    aria-hidden="true"
                    className="size-5 text-[var(--status-success)]"
                    strokeWidth={1.8}
                  />
                  <span className="font-bold text-primary">{item}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-4 rounded-[var(--radius-lg)] border border-line bg-subtle p-5">
            <h2 className="m-0 text-[26px] font-bold leading-[1.32] text-primary">후기와 안전</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-2 rounded-[var(--radius-md)] bg-canvas p-4">
                <span className="inline-flex items-center gap-2 text-sm font-bold text-primary">
                  <Star aria-hidden="true" className="size-4 text-accent" strokeWidth={1.8} />
                  후기 요약
                </span>
                <p className="m-0 text-sm leading-[1.6] text-secondary">{lesson.reviewSummary}</p>
              </div>
              <div className="grid gap-2 rounded-[var(--radius-md)] bg-canvas p-4">
                <span className="inline-flex items-center gap-2 text-sm font-bold text-primary">
                  <Flag aria-hidden="true" className="size-4 text-accent" strokeWidth={1.8} />
                  신고와 문의
                </span>
                <p className="m-0 text-sm leading-[1.6] text-secondary">
                  수업 전후 문제는 예약 내역에서 신고해요.
                </p>
              </div>
            </div>
          </section>
        </div>

        <div className="grid gap-3">
          {auth.kind === "ready" && auth.profile.role === "learner" ? (
            <LessonFavoriteControl lessonId={lesson.id} />
          ) : null}
          <LessonBookingPanel lesson={lesson} />
        </div>
      </section>
    </main>
  )
}
