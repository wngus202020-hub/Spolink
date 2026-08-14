import {
  ArrowLeft,
  ArrowRight,
  CalendarHeart,
  CircleAlert,
  Heart,
  MapPin,
  UserRound,
} from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PublicHeader } from "@/components/layout/public-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import { type FavoriteLessonView, readFavoriteLessonsData } from "@/lib/favorites/read-model"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function MyFavoritesPage() {
  const auth = await readPageAuthProfile()
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured") {
    redirect("/auth/login?next=/mypage/favorites")
  }
  if (auth.kind === "profile_required") {
    redirect("/onboarding/profile")
  }

  const favoriteData = await readFavoriteLessonsData(auth.profile.id)

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />

      <section className="mx-auto grid w-full max-w-[1120px] gap-6 px-4 pb-14 pt-6 md:px-6 md:pt-10">
        <Link
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-canvas px-4 text-sm font-bold text-secondary hover:bg-inset"
          href="/mypage"
        >
          <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.8} />
          마이페이지
        </Link>

        <div className="grid gap-3">
          <StatusBadge tone="neutral">관심 레슨</StatusBadge>
          <h1 className="m-0 text-[34px] font-bold leading-[1.18] text-primary md:text-5xl md:leading-[1.14]">
            찜한 레슨
          </h1>
          <p className="m-0 max-w-[66ch] text-base leading-[1.7] text-secondary md:text-lg">
            저장한 레슨을 마이페이지에서 다시 확인할 수 있어요.
          </p>
        </div>

        {favoriteData.state === "read_failure" ? (
          <section
            className="grid gap-3 rounded-[var(--radius-xl)] border border-line bg-canvas p-6 [box-shadow:var(--shadow-panel)]"
            role="alert"
          >
            <CircleAlert
              aria-hidden="true"
              className="size-6 text-[var(--status-warning)]"
              strokeWidth={1.8}
            />
            <h2 className="m-0 text-[24px] font-bold leading-[1.3] text-primary">
              찜한 레슨을 불러오지 못했어요
            </h2>
            <p className="m-0 text-sm leading-[1.6] text-secondary">
              잠시 후 페이지를 다시 열어 봐요.
            </p>
          </section>
        ) : null}

        {favoriteData.state === "empty" ? <EmptyFavoritesState /> : null}

        {favoriteData.state === "ready" && favoriteData.viewModel ? (
          <section className="grid gap-4" aria-labelledby="favorite-lessons-heading">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
              <div className="grid gap-1">
                <h2
                  className="m-0 text-[24px] font-bold leading-[1.3] text-primary"
                  id="favorite-lessons-heading"
                >
                  저장한 레슨
                </h2>
                <p className="m-0 text-sm text-secondary">
                  총 {favoriteData.viewModel.items.length.toLocaleString("ko-KR")}개
                </p>
              </div>
              <span className="text-sm font-bold text-secondary">최근 저장순</span>
            </div>

            <div className="grid gap-3">
              {favoriteData.viewModel.items.map((favorite) => (
                <FavoriteLessonRow favorite={favorite} key={favorite.lessonId} />
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  )
}

function EmptyFavoritesState() {
  return (
    <section className="grid min-h-64 place-items-center rounded-[var(--radius-xl)] border border-line bg-subtle p-8 text-center">
      <div className="grid max-w-[440px] gap-3">
        <Heart aria-hidden="true" className="mx-auto size-7 text-accent" strokeWidth={1.8} />
        <h2 className="m-0 text-[24px] font-bold leading-[1.3] text-primary">
          아직 찜한 레슨이 없어요
        </h2>
        <p className="m-0 text-sm leading-[1.6] text-secondary">
          관심 있는 레슨을 저장해 두고 나중에 다시 확인해 봐요.
        </p>
        <Link
          className="mx-auto inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] bg-accent px-5 py-3 text-sm font-bold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]"
          href="/lessons"
        >
          레슨 찾기
        </Link>
      </div>
    </section>
  )
}

function FavoriteLessonRow({ favorite }: Readonly<{ favorite: FavoriteLessonView }>) {
  return (
    <article className="grid gap-4 rounded-[var(--radius-lg)] border border-line bg-canvas p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {favorite.sportName ? (
            <StatusBadge tone="neutral">{favorite.sportName}</StatusBadge>
          ) : null}
          <StatusBadge tone={favorite.statusLabel === "예약 가능" ? "success" : "neutral"}>
            {favorite.statusLabel}
          </StatusBadge>
        </div>

        <h3 className="m-0 text-[22px] font-bold leading-[1.36] text-primary">{favorite.title}</h3>

        <div className="grid gap-2 text-sm leading-[1.6] text-secondary md:grid-cols-2">
          <span className="inline-flex min-w-0 items-start gap-2">
            <UserRound
              aria-hidden="true"
              className="mt-1 size-4 shrink-0 text-accent"
              strokeWidth={1.8}
            />
            {favorite.coachName ?? "지도자 정보 확인 필요"}
          </span>
          <span className="inline-flex min-w-0 items-start gap-2">
            <MapPin
              aria-hidden="true"
              className="mt-1 size-4 shrink-0 text-accent"
              strokeWidth={1.8}
            />
            {favorite.location}
          </span>
          <span className="inline-flex min-w-0 items-start gap-2">
            <CalendarHeart
              aria-hidden="true"
              className="mt-1 size-4 shrink-0 text-accent"
              strokeWidth={1.8}
            />
            {favorite.savedAtText} 저장
          </span>
          <strong className="text-lg font-bold text-primary">{favorite.priceText}</strong>
        </div>
      </div>

      {favorite.canViewDetail ? (
        <Link
          aria-label={`${favorite.title} 상세 보기`}
          className="inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-[var(--radius-md)] border border-line bg-canvas px-4 py-2 text-sm font-bold text-primary hover:bg-inset"
          href={`/lessons/${favorite.lessonId}`}
        >
          상세 보기
          <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
        </Link>
      ) : (
        <span className="inline-flex min-h-11 w-fit items-center justify-center rounded-[var(--radius-md)] border border-line bg-subtle px-4 py-2 text-sm font-bold text-secondary">
          공개 중단
        </span>
      )}
    </article>
  )
}
