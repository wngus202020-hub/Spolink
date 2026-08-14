import { RotateCcw } from "lucide-react"
import Link from "next/link"
import { LessonSearchPicker } from "@/components/lessons/lesson-search-picker"
import { defaultFilterValues, type FilterState, normalizeFilter } from "@/lib/lesson-search"

type LessonSearchControlsProps = Readonly<{
  filters: FilterState
}>

export function LessonSearchControls({ filters }: LessonSearchControlsProps) {
  const hasActiveFilters =
    Boolean(normalizeFilter(filters.sport)) ||
    Boolean(normalizeFilter(filters.date)) ||
    normalizeFilter(filters.region) !== normalizeFilter(defaultFilterValues.region)

  return (
    <div className="grid gap-5">
      <LessonSearchPicker initialFilters={filters} submitLabel="검색" variant="lessons" />

      {hasActiveFilters ? (
        <div className="flex flex-wrap items-center gap-2">
          <Link
            className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-canvas px-4 text-sm font-bold text-secondary hover:bg-inset"
            href="/lessons"
          >
            <RotateCcw aria-hidden="true" className="size-4" strokeWidth={1.8} />
            초기화
          </Link>
        </div>
      ) : null}
    </div>
  )
}
