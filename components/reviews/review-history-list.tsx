import Link from "next/link"

import { ReviewHistoryRow } from "@/components/reviews/review-history-row"
import type { ReviewHistoryViewModel } from "@/lib/reviews/read-types"

type ReviewHistoryListProps = Readonly<{
  viewModel: ReviewHistoryViewModel
}>

export function ReviewHistoryList({ viewModel }: ReviewHistoryListProps) {
  return (
    <section className="grid gap-4" aria-label="리뷰 내역">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div className="grid gap-1">
          <h2 className="m-0 text-[length:var(--type-h2-size)] font-bold leading-[var(--type-h2-leading)] text-primary">
            리뷰 내역
          </h2>
          <p className="m-0 text-sm text-secondary">
            총 {viewModel.totalCount.toLocaleString("ko-KR")}건
          </p>
        </div>
        <span className="text-sm font-bold text-secondary">
          {viewModel.page} / {viewModel.totalPages} 페이지
        </span>
      </div>

      <ul className="m-0 grid list-none divide-y divide-line p-0">
        {viewModel.items.map((review) => (
          <li key={review.key}>
            <ReviewHistoryRow review={review} />
          </li>
        ))}
      </ul>

      <ReviewHistoryPagination page={viewModel.page} totalPages={viewModel.totalPages} />
    </section>
  )
}

function ReviewHistoryPagination({
  page,
  totalPages,
}: Readonly<{ page: number; totalPages: number }>) {
  if (totalPages <= 1) return null

  return (
    <nav
      aria-label="리뷰 목록 페이지"
      className="flex flex-wrap items-center justify-center gap-3 pt-3"
    >
      {page > 1 ? (
        <Link
          className="inline-flex min-h-10 items-center rounded-[var(--radius-md)] border border-line bg-canvas px-4 text-sm font-bold text-primary hover:bg-inset"
          href={reviewPageHref(page - 1)}
        >
          이전
        </Link>
      ) : (
        <span className="inline-flex min-h-10 items-center rounded-[var(--radius-md)] bg-inset px-4 text-sm font-bold text-tertiary">
          이전
        </span>
      )}
      {page < totalPages ? (
        <Link
          className="inline-flex min-h-10 items-center rounded-[var(--radius-md)] border border-line bg-canvas px-4 text-sm font-bold text-primary hover:bg-inset"
          href={reviewPageHref(page + 1)}
        >
          다음
        </Link>
      ) : (
        <span className="inline-flex min-h-10 items-center rounded-[var(--radius-md)] bg-inset px-4 text-sm font-bold text-tertiary">
          다음
        </span>
      )}
    </nav>
  )
}

function reviewPageHref(page: number): string {
  return page === 1 ? "/mypage/reviews" : `/mypage/reviews?page=${page}`
}
