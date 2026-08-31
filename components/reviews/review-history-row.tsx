import { Star } from "lucide-react"
import Link from "next/link"

import { StatusBadge } from "@/components/ui/status-badge"
import type { ReviewHistoryItemView } from "@/lib/reviews/read-types"

type ReviewHistoryRowProps = Readonly<{
  review: ReviewHistoryItemView
}>

const ratingStars = [1, 2, 3, 4, 5] as const

export function ReviewHistoryRow({ review }: ReviewHistoryRowProps) {
  return (
    <article className="grid min-w-0 gap-4 border-b border-line py-5 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={review.status.tone}>{review.status.label}</StatusBadge>
          <span
            aria-label={review.ratingLabel}
            className="inline-flex items-center gap-1"
            role="img"
          >
            {ratingStars.map((star) => (
              <Star
                aria-hidden="true"
                className={
                  star <= review.rating ? "size-4 fill-current text-accent" : "size-4 text-tertiary"
                }
                key={`${review.key}-${star}`}
                strokeWidth={1.8}
              />
            ))}
          </span>
          <time className="text-sm text-secondary">{review.createdAtText}</time>
        </div>

        {review.lessonHref ? (
          <Link
            className="inline-flex min-h-11 w-fit max-w-full items-center break-words text-[length:var(--type-body-lg-size)] font-bold leading-snug text-primary underline-offset-4 hover:underline"
            href={review.lessonHref}
          >
            {review.lessonTitle}
          </Link>
        ) : (
          <h3 className="m-0 break-words text-[length:var(--type-body-lg-size)] font-bold leading-snug text-primary">
            {review.lessonTitle}
          </h3>
        )}

        <p className="m-0 break-words text-sm leading-relaxed text-secondary">{review.content}</p>

        {review.status.tone === "warning" && review.hiddenReason ? (
          <p className="m-0 break-words border-l-2 border-[var(--status-warning)] pl-3 text-sm leading-relaxed text-secondary">
            <strong className="font-bold text-primary">숨김 사유</strong>
            <span className="ml-2">{review.hiddenReason}</span>
          </p>
        ) : null}
      </div>
    </article>
  )
}
