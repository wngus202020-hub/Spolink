import { LessonSearchPicker } from "@/components/lessons/lesson-search-picker"
import { defaultFilterValues } from "@/lib/lesson-search"

export function SearchPill() {
  return (
    <LessonSearchPicker
      initialFilters={defaultFilterValues}
      submitLabel="레슨 찾기"
      variant="home"
    />
  )
}
