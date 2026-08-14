import { ArrowRight, MapPin, Star, Users } from "lucide-react"
import Link from "next/link"
import { LessonCardMedia } from "@/components/home/lesson-card-media"
import { StatusBadge } from "@/components/ui/status-badge"
import type { Lesson } from "@/lib/home-data"

type LessonCardProps = Readonly<{
  detailHref?: string
  lesson: Lesson
}>

const lessonStatusLabels: Record<Lesson["status"], string> = {
  active: "예약 가능",
  closed: "예약 종료",
  pending_review: "검토 중",
}

const lessonStatusTones: Record<Lesson["status"], "neutral" | "success" | "warning"> = {
  active: "success",
  closed: "neutral",
  pending_review: "warning",
}

export function LessonCard({ detailHref, lesson }: LessonCardProps) {
  return (
    <article className="grid gap-3">
      <LessonCardMedia media={lesson.media} title={lesson.title} />

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-bold text-primary">{lesson.sport}</span>
          <StatusBadge tone={lessonStatusTones[lesson.status]}>
            {lessonStatusLabels[lesson.status]}
          </StatusBadge>
        </div>

        <h3 className="text-[22px] font-bold leading-[1.36] text-primary">{lesson.title}</h3>

        <div className="grid gap-1 text-sm text-secondary">
          <span className="inline-flex items-center gap-1.5">
            <MapPin aria-hidden="true" className="size-4" strokeWidth={1.8} />
            {lesson.region}
          </span>
          <span>{lesson.coachName}</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-secondary">
          <span className="inline-flex items-center gap-1.5">
            <Star aria-hidden="true" className="size-4 text-accent" strokeWidth={1.8} />
            {lesson.ratingText}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users aria-hidden="true" className="size-4" strokeWidth={1.8} />
            {lesson.capacityText}
          </span>
        </div>

        <div className="flex items-end justify-between gap-3 pt-1">
          <span className="text-sm text-secondary">{lesson.scheduleText}</span>
          <strong className="text-lg font-bold text-primary">{lesson.priceText}</strong>
        </div>

        {detailHref ? (
          <Link
            className="inline-flex min-h-10 w-fit items-center gap-2 rounded-[var(--radius-md)] border border-line bg-canvas px-4 py-2 text-sm font-bold text-primary hover:bg-inset"
            href={detailHref}
          >
            상세 보기
            <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
          </Link>
        ) : null}
      </div>
    </article>
  )
}
