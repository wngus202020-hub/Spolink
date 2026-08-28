import { ArrowLeft, CircleAlert } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { FavoriteLessonsList } from "@/components/favorites/favorite-lessons-list"
import { PublicHeader } from "@/components/layout/public-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import { readFavoriteLessonsData } from "@/lib/favorites/read-model"

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
          <h1 className="m-0 text-[length:var(--type-h1-size)] font-bold leading-[var(--type-h1-leading)] text-primary">
            찜한 레슨
          </h1>
          <p className="m-0 max-w-[66ch] text-base leading-relaxed text-secondary md:text-lg">
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
            <h2 className="m-0 text-[length:var(--type-h2-size)] font-bold leading-[var(--type-h2-leading)] text-primary">
              찜한 레슨을 불러오지 못했어요
            </h2>
            <p className="m-0 text-sm leading-normal text-secondary">
              잠시 후 페이지를 다시 열어 봐요.
            </p>
          </section>
        ) : null}

        {favoriteData.state !== "read_failure" ? (
          <FavoriteLessonsList initialItems={favoriteData.viewModel?.items ?? []} />
        ) : null}
      </section>
    </main>
  )
}
