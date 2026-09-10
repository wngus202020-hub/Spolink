import { SlidersHorizontal } from "lucide-react"
import Link from "next/link"
import { PublicHeader } from "@/components/layout/public-header"
import { LessonResultsView } from "@/components/lessons/lesson-results-view"
import { LessonSearchControls } from "@/components/lessons/lesson-search-controls"
import { StatusBadge } from "@/components/ui/status-badge"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import { includesFilter, readFilters, type SearchParams } from "@/lib/lesson-search"
import { getLessonsForSearchDisplay } from "@/lib/lessons/display-lessons"
import { readNaverMapsClientId } from "@/lib/maps/geocoding-env"

export const dynamic = "force-dynamic"
export const revalidate = 0

type LessonsPageProps = Readonly<{
  searchParams: Promise<SearchParams>
}>

export default async function LessonsPage({ searchParams }: LessonsPageProps) {
  const [auth, rawSearchParams] = await Promise.all([readPageAuthProfile(), searchParams])
  const filters = readFilters(rawSearchParams)
  const searchResult = await getLessonsForSearchDisplay(filters)
  const lessons = searchResult.lessons
  const publishedLessons = lessons.filter((lesson) => lesson.status === "active")
  const filteredLessons = publishedLessons.filter(
    (lesson) =>
      includesFilter(lesson.region, filters.region) && includesFilter(lesson.sport, filters.sport),
  )
  const resultBasis = filters.date ? `${filters.date} 일정` : `${filters.region} 기준`
  const mapClientId = readNaverMapsClientId()
  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />

      <section className="mx-auto grid w-full max-w-[1280px] gap-8 px-4 pb-12 pt-8 md:px-6 lg:pt-12">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
          <div className="grid max-w-[780px] gap-4">
            <div className="inline-flex w-fit items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-canvas px-4 py-2 text-sm font-bold text-secondary">
              <SlidersHorizontal
                aria-hidden="true"
                className="size-4 text-accent"
                strokeWidth={1.8}
              />
              Sport Lesson
            </div>
            <h1 className="m-0 text-[34px] font-bold leading-[1.18] text-primary md:text-5xl md:leading-[1.14]">
              <span className="block sm:inline">가까운 인증 지도자</span>{" "}
              <span className="block sm:inline">레슨 찾기</span>
            </h1>
            <p className="m-0 max-w-[64ch] text-base leading-[1.7] text-secondary md:text-lg">
              지역, 종목, 일정 조건으로 가까운 레슨을 찾아요. 결제와 환불은 예약 단계에서 안내돼요.
            </p>
          </div>

          <div className="rounded-[var(--radius-lg)] border border-line bg-canvas p-4">
            <span className="text-sm text-secondary">공개 레슨</span>
            <strong className="mt-1 block text-3xl font-bold text-primary">
              {filteredLessons.length}개
            </strong>
            <p className="m-0 mt-2 text-sm leading-[1.55] text-secondary">
              심사 중인 레슨은 관리자 승인 후 노출돼요.
            </p>
          </div>
        </div>

        <LessonSearchControls filters={filters} />
      </section>

      <section className="border-t border-line-subtle bg-canvas">
        <div className="mx-auto grid w-full max-w-[1280px] gap-8 px-4 py-12 md:px-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-6">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
              <div className="grid gap-1">
                <h2 className="m-0 text-[26px] font-bold leading-[1.32] text-primary">검색 결과</h2>
                <p className="m-0 text-sm text-secondary">
                  {resultBasis}으로 예약 가능한 공개 레슨을 보여드려요.
                </p>
              </div>
              <StatusBadge tone="success">인증 지도자 공개 레슨</StatusBadge>
            </div>

            {searchResult.status === "failure" ? (
              <div className="grid min-h-64 place-items-center rounded-[var(--radius-lg)] border border-line bg-subtle p-8 text-center">
                <div className="grid max-w-[420px] gap-3">
                  <h3 className="m-0 text-2xl font-bold text-primary">레슨을 불러오지 못했어요</h3>
                  <p className="m-0 text-secondary">잠시 후 다시 검색해 주세요.</p>
                  <Link
                    className="mx-auto inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] bg-accent px-5 py-3 text-sm font-bold text-white hover:bg-[var(--accent-hover)]"
                    href="/lessons"
                  >
                    다시 시도하기
                  </Link>
                </div>
              </div>
            ) : filteredLessons.length > 0 ? (
              <LessonResultsView lessons={filteredLessons} mapClientId={mapClientId} />
            ) : (
              <div className="grid min-h-64 place-items-center rounded-[var(--radius-lg)] border border-line bg-subtle p-8 text-center">
                <div className="grid max-w-[420px] gap-3">
                  <h3 className="m-0 text-2xl font-bold text-primary">
                    <span className="block">아직 조건에 맞는</span>
                    <span className="block">레슨이 없어요</span>
                  </h3>
                  <p className="m-0 text-secondary">
                    {filters.date
                      ? "다른 날짜를 선택하거나 지역과 종목 조건을 넓혀 보세요."
                      : "지역을 넓히거나 종목을 줄이면 더 쉽게 찾을 수 있어요."}
                  </p>
                  <Link
                    className="mx-auto inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] bg-accent px-5 py-3 text-sm font-bold text-white hover:bg-[var(--accent-hover)]"
                    href="/lessons"
                  >
                    추천 레슨 보기
                  </Link>
                </div>
              </div>
            )}
          </div>

          <aside className="grid h-fit gap-4 rounded-[var(--radius-lg)] border border-line bg-subtle p-5">
            <div className="grid gap-1">
              <span className="text-sm font-bold text-accent">지역 기준</span>
              <strong className="text-2xl font-bold text-primary">{filters.region}</strong>
              <p className="m-0 text-sm leading-[1.6] text-secondary">
                목록과 지도에서 위치가 등록된 공개 레슨을 함께 확인할 수 있어요.
              </p>
            </div>

            <div className="grid gap-3 border-t border-line pt-4 text-sm text-secondary">
              <span className="flex items-center justify-between gap-3">
                <span>예약 가능</span>
                <strong className="text-primary">{publishedLessons.length}개</strong>
              </span>
              <span className="flex items-center justify-between gap-3">
                <span>현재 결과</span>
                <strong className="text-primary">{filteredLessons.length}개</strong>
              </span>
              <span className="flex items-center justify-between gap-3">
                <span>검토 중 제외</span>
                <strong className="text-primary">
                  {lessons.length - publishedLessons.length}개
                </strong>
              </span>
            </div>
          </aside>
        </div>
      </section>
    </main>
  )
}
