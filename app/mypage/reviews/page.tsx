import { ArrowLeft, CircleAlert, MessageSquareText } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { PublicHeader } from "@/components/layout/public-header"
import { ReviewHistoryList } from "@/components/reviews/review-history-list"
import { StatusBadge } from "@/components/ui/status-badge"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import { normalizeReviewHistoryPage, readReviewHistoryData } from "@/lib/reviews/read-model"

type MyReviewsPageProps = Readonly<{
  searchParams: Promise<{
    page?: string | string[]
  }>
}>

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function MyReviewsPage({ searchParams }: MyReviewsPageProps) {
  const [auth, query] = await Promise.all([readPageAuthProfile(), searchParams])
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured") {
    redirect("/auth/login?next=/mypage/reviews")
  }
  if (auth.kind === "profile_required") {
    redirect("/onboarding/profile")
  }

  const page = normalizeReviewHistoryPage(query.page)
  const reviewData = await readReviewHistoryData(auth.profile.id, page)

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
          <StatusBadge tone="neutral">리뷰 관리</StatusBadge>
          <h1 className="m-0 text-[length:var(--type-h1-size)] font-bold leading-[var(--type-h1-leading)] text-primary">
            내 리뷰
          </h1>
          <p className="m-0 max-w-[66ch] text-base leading-relaxed text-secondary md:text-lg">
            작성한 리뷰와 공개 상태를 확인해요.
          </p>
        </div>

        {reviewData.state === "read_failure" ? <ReviewReadFailure /> : null}
        {reviewData.state === "empty" && reviewData.viewModel ? <EmptyReviewState /> : null}
        {reviewData.state === "out_of_range" && reviewData.viewModel ? (
          <OutOfRangeReviewState />
        ) : null}
        {reviewData.state === "ready" && reviewData.viewModel ? (
          <ReviewHistoryList viewModel={reviewData.viewModel} />
        ) : null}
      </section>
    </main>
  )
}

function ReviewReadFailure() {
  return (
    <section className="grid gap-3 border border-line bg-canvas p-6" role="alert">
      <CircleAlert
        aria-hidden="true"
        className="size-6 text-[var(--status-warning)]"
        strokeWidth={1.8}
      />
      <h2 className="m-0 text-[length:var(--type-h2-size)] font-bold leading-[var(--type-h2-leading)] text-primary">
        리뷰 내역을 불러오지 못했어요
      </h2>
      <p className="m-0 text-sm leading-relaxed text-secondary">잠시 후 페이지를 다시 열어 봐요.</p>
    </section>
  )
}

function EmptyReviewState() {
  return (
    <section className="grid min-h-64 place-items-center border border-line bg-subtle p-8 text-center">
      <div className="grid max-w-[420px] gap-3">
        <MessageSquareText
          aria-hidden="true"
          className="mx-auto size-7 text-accent"
          strokeWidth={1.8}
        />
        <h2 className="m-0 text-[length:var(--type-h2-size)] font-bold leading-[var(--type-h2-leading)] text-primary">
          아직 작성한 리뷰가 없어요
        </h2>
        <p className="m-0 text-sm leading-relaxed text-secondary">
          완료한 예약에서 레슨 경험을 남겨 보세요.
        </p>
        <Link
          className="mx-auto inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] bg-accent px-5 py-3 text-sm font-bold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]"
          href="/mypage/reservations"
        >
          예약 내역 보기
        </Link>
      </div>
    </section>
  )
}

function OutOfRangeReviewState() {
  return (
    <section className="grid min-h-64 place-items-center border border-line bg-subtle p-8 text-center">
      <div className="grid max-w-[420px] gap-3">
        <MessageSquareText
          aria-hidden="true"
          className="mx-auto size-7 text-accent"
          strokeWidth={1.8}
        />
        <h2 className="m-0 text-[length:var(--type-h2-size)] font-bold leading-[var(--type-h2-leading)] text-primary">
          리뷰 목록 페이지를 다시 선택해요
        </h2>
        <p className="m-0 text-sm leading-relaxed text-secondary">
          요청한 페이지에 표시할 리뷰가 없어요. 첫 페이지에서 다시 확인해요.
        </p>
        <Link
          className="mx-auto inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] bg-accent px-5 py-3 text-sm font-bold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]"
          href="/mypage/reviews"
        >
          첫 페이지 보기
        </Link>
      </div>
    </section>
  )
}
