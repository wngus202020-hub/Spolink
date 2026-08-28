import { ArrowRight, CalendarHeart, HeartOff, MapPin, UserRound } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/status-badge"
import type { FavoriteLessonView } from "@/lib/favorites/read-model"

export function FavoriteLessonRow({
  favorite,
  pending,
  removeFavorite,
}: Readonly<{
  favorite: FavoriteLessonView
  pending: boolean
  removeFavorite: (item: FavoriteLessonView) => Promise<void>
}>) {
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
        <h3 className="m-0 text-[length:var(--type-body-lg-size)] font-bold leading-snug text-primary">
          {favorite.title}
        </h3>
        <div className="grid gap-2 text-sm leading-normal text-secondary md:grid-cols-2">
          <Metadata icon={UserRound}>{favorite.coachName ?? "지도자 정보 확인 필요"}</Metadata>
          <Metadata icon={MapPin}>{favorite.location}</Metadata>
          <Metadata icon={CalendarHeart}>{favorite.savedAtText} 저장</Metadata>
          <strong className="text-lg font-bold text-primary">{favorite.priceText}</strong>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 lg:justify-end">
        <Button
          aria-busy={pending}
          disabled={pending}
          onClick={() => removeFavorite(favorite)}
          variant="outline"
        >
          <HeartOff aria-hidden="true" className="size-4" strokeWidth={1.8} />
          {pending ? "삭제 중" : "찜 삭제"}
        </Button>
        {favorite.canViewDetail ? (
          <Link
            aria-label={`${favorite.title} 상세 보기`}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-line bg-canvas px-4 py-2 text-sm font-bold text-primary hover:bg-inset"
            href={`/lessons/${favorite.lessonId}`}
          >
            상세 보기
            <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
          </Link>
        ) : null}
      </div>
    </article>
  )
}

function Metadata({
  children,
  icon: Icon,
}: Readonly<{
  children: ReactNode
  icon: typeof UserRound
}>) {
  return (
    <span className="inline-flex min-w-0 items-start gap-2">
      <Icon aria-hidden="true" className="mt-1 size-4 shrink-0 text-accent" strokeWidth={1.8} />
      {children}
    </span>
  )
}
