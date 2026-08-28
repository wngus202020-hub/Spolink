"use client"

import { Check, MapPin, Search, X } from "lucide-react"
import { type RefObject, useId, useState } from "react"
import { type LessonRegion, type LessonRegionDistrict, lessonRegions } from "@/lib/lesson-regions"
import {
  searchRegionOptions,
  sortLessonRegions,
  sortRegionDistricts,
} from "@/lib/lesson-search-options"
import { isCanonicalProfileRegion } from "@/lib/profile/region-contract"

export { isCanonicalProfileRegion }

type ProfileRegionCategory = "district" | "province"

export type ProfileRegionOption = Readonly<{
  category: ProfileRegionCategory
  key: string
  label: string
  value: string
}>

export type ProfileRegionPickerState = Readonly<{
  needsReselection: boolean
  query: string
  selectedValue: string | null
}>

export type ProfileRegionPickerAction =
  | Readonly<{ kind: "clear-search" }>
  | Readonly<{ kind: "search"; query: string }>
  | Readonly<{ kind: "select"; value: string }>

type ProfileRegionPickerProps = Readonly<{
  describedBy?: string | undefined
  disabled?: boolean
  inputRef?: RefObject<HTMLInputElement | null>
  invalid?: boolean
  onChange: (value: string) => void
  value: string | null
}>

const profileRegionOptions: readonly ProfileRegionOption[] = sortLessonRegions<LessonRegion>(
  lessonRegions,
).flatMap((region) => [
  {
    category: "province",
    key: `province:${region.sourceCode}:${region.queryValue}`,
    label: region.label,
    value: region.queryValue,
  },
  ...sortRegionDistricts<LessonRegionDistrict>(region.districts).map((district) => ({
    category: "district" as const,
    key: `district:${district.code}`,
    label: `${region.label} · ${district.label}`,
    value: district.queryValue,
  })),
])

export function getProfileRegionOptions(query: string): readonly ProfileRegionOption[] {
  if (!query.trim()) return profileRegionOptions

  const matchingValues = new Set(
    searchRegionOptions(lessonRegions, query).map((option) => option.value),
  )

  return profileRegionOptions.filter((option) => matchingValues.has(option.value))
}

export function createProfileRegionPickerState(value: string | null): ProfileRegionPickerState {
  const selectedValue = isCanonicalProfileRegion(value) ? value : null

  return {
    needsReselection: selectedValue === null,
    query: "",
    selectedValue,
  }
}

export function reduceProfileRegionPickerState(
  state: ProfileRegionPickerState,
  action: ProfileRegionPickerAction,
): ProfileRegionPickerState {
  switch (action.kind) {
    case "clear-search":
      return { ...state, query: "" }
    case "search":
      return { ...state, query: action.query }
    case "select":
      return isCanonicalProfileRegion(action.value)
        ? { needsReselection: false, query: state.query, selectedValue: action.value }
        : state
  }
}

export function ProfileRegionPicker({
  describedBy,
  disabled = false,
  inputRef,
  invalid = false,
  onChange,
  value,
}: ProfileRegionPickerProps) {
  const inputId = useId()
  const resultsId = useId()
  const [query, setQuery] = useState("")
  const pickerState = createProfileRegionPickerState(value)
  const options = getProfileRegionOptions(query)

  const clearSearch = () => setQuery("")

  return (
    <section aria-labelledby={`${inputId}-label`} className="grid gap-3">
      <div className="grid gap-1">
        <label className="text-sm font-bold text-primary" htmlFor={inputId} id={`${inputId}-label`}>
          지역 검색
        </label>
        <p className="m-0 text-sm text-secondary">시·도 또는 시·군·구를 선택해 주세요.</p>
      </div>

      {pickerState.needsReselection ? (
        <p
          aria-live="polite"
          className="m-0 rounded-[var(--radius-md)] border border-status-warning bg-inset px-3 py-2 text-sm font-medium text-primary"
          role="alert"
        >
          지역을 다시 선택해 주세요
        </p>
      ) : null}

      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-secondary"
          strokeWidth={1.8}
        />
        <input
          aria-describedby={[resultsId, describedBy].filter(Boolean).join(" ")}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          className="min-h-12 w-full rounded-[var(--radius-md)] border border-line bg-inset py-3 pl-11 pr-12 text-base text-primary placeholder:text-tertiary"
          disabled={disabled}
          enterKeyHint="search"
          id={inputId}
          inputMode="search"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault()
          }}
          placeholder="강남구, 수원시"
          ref={inputRef}
          type="search"
          value={query}
        />
        {query ? (
          <button
            aria-label="지역 검색어 지우기"
            className="absolute right-1 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-secondary hover:bg-canvas hover:text-primary"
            disabled={disabled}
            onClick={clearSearch}
            type="button"
          >
            <X aria-hidden="true" className="size-4" strokeWidth={2} />
          </button>
        ) : null}
      </div>

      <p aria-live="polite" className="m-0 text-sm text-secondary" id={resultsId} role="status">
        검색 결과 {options.length}개
      </p>

      {options.length > 0 ? (
        <fieldset
          aria-label="지역 선택지"
          className="m-0 grid grid-cols-1 gap-2 border-0 p-0 sm:grid-cols-2"
        >
          {options.map((option) => {
            const isSelected = pickerState.selectedValue === option.value

            return (
              <button
                aria-pressed={isSelected}
                className={[
                  "inline-flex min-h-11 w-full items-center gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-left text-sm font-bold whitespace-normal break-keep",
                  isSelected
                    ? "border-accent bg-accent-soft text-primary"
                    : "border-line bg-canvas text-secondary hover:border-secondary hover:text-primary",
                ].join(" ")}
                disabled={disabled}
                key={option.key}
                onClick={() => onChange(option.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault()
                }}
                type="button"
              >
                <MapPin
                  aria-hidden="true"
                  className="size-4 shrink-0 text-accent"
                  strokeWidth={1.8}
                />
                <span className="min-w-0 flex-1">{option.label}</span>
                {isSelected ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-primary">
                    <Check aria-hidden="true" className="size-4" strokeWidth={2} />
                    <span className="sr-only">선택됨</span>
                  </span>
                ) : null}
              </button>
            )
          })}
        </fieldset>
      ) : (
        <p className="m-0 rounded-[var(--radius-md)] bg-inset px-4 py-5 text-center text-sm text-secondary">
          일치하는 지역이 없어요. 목록에서 지역을 선택해 주세요.
        </p>
      )}
    </section>
  )
}
