"use client"

import Image from "next/image"
import { useRef, useState } from "react"

import type { LessonMedia } from "@/lib/home-data"

type LessonCardMediaProps = Readonly<{
  media: LessonMedia
  priority?: boolean
  sizes?: string
  surface?: "card" | "detail"
  title: string
}>

const cardSizes = "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"

export function LessonCardMedia({
  media,
  priority = false,
  sizes = cardSizes,
  surface = "card",
  title,
}: LessonCardMediaProps) {
  const hasHandledLoadError = useRef(false)
  const [visibleMedia, setVisibleMedia] = useState(media)
  const radiusClassName =
    surface === "detail" ? "rounded-[var(--radius-xl)]" : "rounded-[var(--radius-lg)]"
  const aspectClassName = surface === "detail" ? "aspect-[4/3] lg:aspect-[16/9]" : "aspect-[4/3]"

  const handleLoadError = () => {
    if (hasHandledLoadError.current) return

    hasHandledLoadError.current = true
    setVisibleMedia({ kind: "missing" })
  }

  switch (visibleMedia.kind) {
    case "photo":
      return (
        <div
          className={`relative overflow-hidden ${aspectClassName} ${radiusClassName} bg-inset`}
          data-lesson-media-state="photo"
        >
          <Image
            alt={title}
            className="object-cover"
            fill={true}
            onError={handleLoadError}
            priority={priority}
            sizes={sizes}
            src={visibleMedia.src}
          />
        </div>
      )
    case "missing": {
      const missingLabel = `${title} 대표 이미지 준비 중`

      return (
        <div
          aria-label={missingLabel}
          className={`grid place-items-center overflow-hidden ${aspectClassName} ${radiusClassName} bg-inset px-6 text-center text-sm font-bold text-secondary`}
          data-lesson-media-state="missing"
          role="img"
        >
          <span>대표 이미지 준비 중</span>
        </div>
      )
    }
    default:
      return visibleMedia satisfies never
  }
}
