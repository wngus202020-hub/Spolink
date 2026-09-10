"use client"

import { List, Map as MapIcon } from "lucide-react"
import { useState } from "react"

import { LessonCard } from "@/components/home/lesson-card"
import type { Lesson } from "@/lib/home-data"
import { LessonMap } from "./lesson-map"

type ResultMode = "list" | "map"

export function LessonResultsView({
  lessons,
  mapClientId,
}: Readonly<{
  lessons: readonly Lesson[]
  mapClientId: string | null
}>) {
  const [mode, setMode] = useState<ResultMode>("list")

  return (
    <div className="grid gap-5">
      <fieldset className="grid w-full grid-cols-2 rounded-[var(--radius-pill)] bg-inset p-1 sm:w-fit sm:min-w-56">
        <legend className="sr-only">검색 결과 보기 방식</legend>
        <ModeButton
          active={mode === "list"}
          icon={List}
          label="목록"
          onClick={() => setMode("list")}
        />
        <ModeButton
          active={mode === "map"}
          icon={MapIcon}
          label="지도"
          onClick={() => setMode("map")}
        />
      </fieldset>

      {mode === "list" ? (
        <div className="grid gap-8 sm:grid-cols-2">
          {lessons.map((lesson) => (
            <LessonCard detailHref={`/lessons/${lesson.id}`} key={lesson.id} lesson={lesson} />
          ))}
        </div>
      ) : (
        <LessonMap clientId={mapClientId} lessons={lessons} />
      )}
    </div>
  )
}

function ModeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: Readonly<{
  active: boolean
  icon: typeof List
  label: string
  onClick: () => void
}>) {
  return (
    <button
      aria-pressed={active}
      className={[
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-pill)] px-4 text-sm font-bold",
        active ? "bg-canvas text-primary" : "text-secondary hover:text-primary",
      ].join(" ")}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" className="size-4" strokeWidth={1.8} />
      {label}
    </button>
  )
}
