import { ChevronLeft } from "lucide-react"
import { useState } from "react"
import { ChoiceButton } from "@/components/lessons/lesson-search-filter-content"
import { SearchableChoiceInput } from "@/components/lessons/searchable-choice-input"
import type { LessonRegion } from "@/lib/lesson-regions"
import { lessonRegions } from "@/lib/lesson-regions"
import { allRegionsFilterValue, sportFilters } from "@/lib/lesson-search"
import {
  filterSportOptions,
  searchRegionOptions,
  sortLessonRegions,
  sortRegionDistricts,
} from "@/lib/lesson-search-options"

const sortedLessonRegions = sortLessonRegions(lessonRegions)

type RegionSearchPanelProps = Readonly<{
  onCategoryChange: (category: LessonRegion | null) => void
  onSelect: (value: string) => void
  selectedCategory: LessonRegion | null
  selectedValue: string
}>

export function RegionSearchPanel({
  onCategoryChange,
  onSelect,
  selectedCategory,
  selectedValue,
}: RegionSearchPanelProps) {
  const [query, setQuery] = useState("")
  const matchingOptions = searchRegionOptions(lessonRegions, query)
  const hasQuery = query.trim().length > 0
  const visibleCount = hasQuery
    ? matchingOptions.length
    : selectedCategory
      ? selectedCategory.districts.length + 1
      : sortedLessonRegions.length + 1

  const changeQuery = (value: string) => {
    setQuery(value)
    onCategoryChange(null)
    onSelect(value.trim() || allRegionsFilterValue)
  }

  return (
    <div className="grid gap-3">
      <SearchableChoiceInput
        label="지역명 검색"
        onChange={changeQuery}
        placeholder="강남구, 수원시"
        resultCount={visibleCount}
        value={query}
      />

      {hasQuery ? (
        matchingOptions.length > 0 ? (
          <div className="grid max-h-[19rem] grid-cols-2 gap-2 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-3 lg:grid-cols-4">
            {matchingOptions.map((option) => (
              <ChoiceButton
                isSelected={selectedValue === option.value}
                key={option.key}
                label={option.label}
                onSelect={() => {
                  setQuery("")
                  onCategoryChange(option.category)
                  onSelect(option.value)
                }}
              />
            ))}
          </div>
        ) : (
          <EmptySearchResult subject="지역" />
        )
      ) : selectedCategory ? (
        <RegionDistrictChoices
          category={selectedCategory}
          onBack={() => onCategoryChange(null)}
          onSelect={onSelect}
          selectedValue={selectedValue}
        />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <ChoiceButton
            isSelected={selectedValue === allRegionsFilterValue}
            label={allRegionsFilterValue}
            onSelect={() => onSelect(allRegionsFilterValue)}
          />
          {sortedLessonRegions.map((category) => (
            <ChoiceButton
              isSelected={selectedValue.startsWith(category.queryValue)}
              key={category.sourceCode}
              label={category.label}
              onSelect={() => {
                onCategoryChange(category)
                onSelect(category.queryValue)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function SportSearchPanel({
  onSelect,
  selectedValue,
}: Readonly<{ onSelect: (value: string) => void; selectedValue: string }>) {
  const [query, setQuery] = useState("")
  const matchingOptions = filterSportOptions(sportFilters, query)

  const changeQuery = (value: string) => {
    setQuery(value)
    onSelect(value.trim())
  }

  return (
    <div className="grid gap-3">
      <SearchableChoiceInput
        label="종목명 검색"
        onChange={changeQuery}
        placeholder="태권도, 테니스"
        resultCount={matchingOptions.length}
        value={query}
      />
      {matchingOptions.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {matchingOptions.map((option) => {
            const optionValue = option === "전체" ? "" : option
            return (
              <ChoiceButton
                isSelected={selectedValue === optionValue}
                key={option}
                label={option}
                onSelect={() => {
                  setQuery("")
                  onSelect(optionValue)
                }}
              />
            )
          })}
        </div>
      ) : (
        <EmptySearchResult subject="종목" />
      )}
    </div>
  )
}

function RegionDistrictChoices({
  category,
  onBack,
  onSelect,
  selectedValue,
}: Readonly<{
  category: LessonRegion
  onBack: () => void
  onSelect: (value: string) => void
  selectedValue: string
}>) {
  return (
    <div className="grid gap-3">
      <button
        aria-label="시·도 목록으로 돌아가기"
        className="inline-flex min-h-11 w-fit items-center gap-2 rounded-[var(--radius-md)] px-3 text-sm font-bold text-secondary hover:bg-inset"
        onClick={onBack}
        type="button"
      >
        <ChevronLeft aria-hidden="true" className="size-4" strokeWidth={1.8} />
        시·도 다시 선택
      </button>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:max-h-[19rem] md:overflow-y-auto md:overscroll-contain md:pr-1 lg:grid-cols-4">
        <ChoiceButton
          isSelected={selectedValue === category.queryValue}
          label={`${category.label} 전체`}
          onSelect={() => onSelect(category.queryValue)}
        />
        {sortRegionDistricts(category.districts).map((district) => (
          <ChoiceButton
            isSelected={selectedValue === district.queryValue}
            key={district.code}
            label={district.label}
            onSelect={() => onSelect(district.queryValue)}
          />
        ))}
      </div>
    </div>
  )
}

function EmptySearchResult({ subject }: Readonly<{ subject: string }>) {
  return (
    <p className="m-0 rounded-[var(--radius-md)] bg-inset px-4 py-5 text-center text-sm text-secondary">
      일치하는 {subject}이 없어요. 입력한 글자로 바로 검색할 수 있어요.
    </p>
  )
}
