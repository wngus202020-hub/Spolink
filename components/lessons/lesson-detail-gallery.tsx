"use client"

import Image from "next/image"
import { type Dispatch, type SetStateAction, useState } from "react"
import { LessonCardMedia } from "@/components/home/lesson-card-media"
import type { LessonMediaImage } from "@/lib/home-data"

type LessonDetailGalleryProps = Readonly<{
  images: readonly LessonMediaImage[]
  title: string
}>

export function LessonDetailGallery({ images, title }: LessonDetailGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [brokenImageIndexes, setBrokenImageIndexes] = useState<ReadonlySet<number>>(() => new Set())
  const activeIndex = images[selectedIndex] ? selectedIndex : 0
  const activeImage = images[activeIndex]

  if (!activeImage) {
    return <LessonCardMedia media={{ kind: "missing" }} surface="detail" title={title} />
  }

  const activeAlt = imageAlt(title, activeIndex, images.length)
  const activeImageIsBroken = brokenImageIndexes.has(activeIndex)

  return (
    <section aria-label={`${title} 레슨 이미지`} className="grid gap-3">
      {activeImageIsBroken ? (
        <LessonCardMedia media={{ kind: "missing" }} surface="detail" title={title} />
      ) : (
        <div
          className="relative aspect-[4/3] overflow-hidden rounded-[var(--radius-xl)] bg-inset lg:aspect-[16/9]"
          data-lesson-gallery-primary="true"
        >
          <Image
            alt={activeAlt}
            className="object-contain"
            fill={true}
            key={activeImage.url}
            onError={() => markImageBroken(activeIndex, setBrokenImageIndexes)}
            priority={true}
            sizes="(min-width: 1024px) 70vw, 100vw"
            src={activeImage.url}
            unoptimized={true}
          />
        </div>
      )}

      {images.length > 1 ? (
        <ul aria-label="레슨 이미지 선택" className="grid grid-cols-5 gap-2">
          {images.map((image, index) => {
            const isSelected = index === activeIndex
            const isBroken = brokenImageIndexes.has(index)

            return (
              <li key={`${image.sortOrder}-${image.url}`}>
                <button
                  aria-current={isSelected ? "true" : undefined}
                  aria-label={imageAlt(title, index, images.length)}
                  aria-pressed={isSelected}
                  className={`relative grid min-h-11 w-full aspect-square place-items-center overflow-hidden rounded-[var(--radius-md)] border bg-inset p-1 transition-colors ${
                    isSelected
                      ? "border-primary bg-canvas"
                      : "border-line hover:border-primary hover:bg-canvas"
                  }`}
                  data-lesson-gallery-thumbnail={index}
                  onClick={() => setSelectedIndex(index)}
                  type="button"
                >
                  {isBroken ? (
                    <span className="px-1 text-center text-xs font-bold leading-[1.35] text-secondary">
                      이미지 준비 중
                    </span>
                  ) : (
                    <Image
                      alt=""
                      className="object-contain"
                      fill={true}
                      onError={() => markImageBroken(index, setBrokenImageIndexes)}
                      sizes="(min-width: 1024px) 112px, 20vw"
                      src={image.url}
                      unoptimized={true}
                    />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}

function imageAlt(title: string, index: number, count: number) {
  return `${title} 이미지 ${index + 1}/${count}`
}

function markImageBroken(
  index: number,
  setBrokenImageIndexes: Dispatch<SetStateAction<ReadonlySet<number>>>,
) {
  setBrokenImageIndexes((current) => new Set(current).add(index))
}
