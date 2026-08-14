import { ArrowRight, MapPin } from "lucide-react"
import Link from "next/link"
import { HomeDiscoveryPanel } from "@/components/home/home-discovery-panel"
import { LessonCard } from "@/components/home/lesson-card"
import { SearchPill } from "@/components/home/search-pill"
import { PublicHeader } from "@/components/layout/public-header"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import { trustMetrics } from "@/lib/home-data"
import { getFeaturedLessonsForDisplay } from "@/lib/lessons/display-lessons"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function HomePage() {
  const [auth, lessons] = await Promise.all([readPageAuthProfile(), getFeaturedLessonsForDisplay()])

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />

      <section className="mx-auto grid w-full max-w-[1280px] gap-[var(--space-8)] px-[var(--space-4)] pb-[var(--space-16)] pt-[var(--space-8)] md:px-[var(--space-6)] lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:pt-[var(--space-12)]">
        <div className="grid gap-[var(--space-8)]">
          <div className="grid max-w-[760px] gap-[var(--space-5)]">
            <div className="inline-flex w-fit items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-canvas px-4 py-2 text-sm font-bold text-secondary">
              <MapPin aria-hidden="true" className="size-4 text-accent" strokeWidth={1.8} />
              가장 가까운 스포츠 플랫폼.
            </div>
            <h1 className="m-0 text-[length:var(--type-h1-size)] font-bold leading-[var(--type-h1-leading)] text-primary md:text-[length:var(--type-display-size)] md:leading-[var(--type-display-leading)]">
              <span className="block sm:inline">가까운 지도자와</span>{" "}
              <span className="block sm:inline">바로 시작하는</span>{" "}
              <span className="block sm:inline">스포츠 레슨</span>
            </h1>
            <p className="m-0 max-w-[62ch] text-[length:var(--type-body-lg-size)] leading-[var(--type-body-lg-leading)] text-secondary">
              배우고, 함께하고, 활동하는 모든 순간을 지역 기반 예약 흐름으로 연결해요.
            </p>
          </div>

          <SearchPill />

          <div className="grid gap-3 sm:grid-cols-3">
            {trustMetrics.map((metric) => (
              <div
                className="rounded-[var(--radius-lg)] border border-line bg-canvas p-4"
                key={metric.label}
              >
                <span className="text-sm text-secondary">{metric.label}</span>
                <strong className="mt-1 block text-xl font-bold text-primary">
                  {metric.value}
                </strong>
              </div>
            ))}
          </div>
        </div>

        <HomeDiscoveryPanel />
      </section>

      <section className="border-t border-line-subtle bg-canvas">
        <div className="mx-auto grid w-full max-w-[1280px] gap-8 px-4 py-14 md:px-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div className="grid gap-2">
              <h2 className="m-0 text-[length:var(--type-h2-size)] font-bold leading-[var(--type-h2-leading)] text-primary">
                이번 주 추천 레슨
              </h2>
              <p className="m-0 text-secondary">
                인증, 일정, 환불 기준을 확인한 뒤 예약으로 이어져요.
              </p>
            </div>
            <Link
              className="inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-[var(--radius-md)] border border-line bg-canvas px-5 py-3 text-sm font-bold text-primary transition-[background-color,transform] duration-150 ease-out hover:bg-inset active:translate-y-px"
              href="/lessons"
            >
              전체 보기
              <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
            </Link>
          </div>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {lessons.map((lesson) => {
              const detailProps =
                lesson.status === "active" ? { detailHref: `/lessons/${lesson.id}` } : {}

              return <LessonCard key={lesson.id} lesson={lesson} {...detailProps} />
            })}
          </div>
        </div>
      </section>
    </main>
  )
}
