"use client"

import { CalendarDays, MapPin, Search, Trophy } from "lucide-react"
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react"
import { LessonSearchFilterContent } from "@/components/lessons/lesson-search-filter-content"
import {
  RegionSearchPanel,
  SportSearchPanel,
} from "@/components/lessons/lesson-search-option-panels"
import { LessonSearchSheet } from "@/components/lessons/lesson-search-sheet"
import { LessonSearchSummary } from "@/components/lessons/lesson-search-summary"
import { TextInput } from "@/components/ui/form-controls"
import type { LessonRegion } from "@/lib/lesson-regions"
import { lessonRegions } from "@/lib/lesson-regions"
import type { FilterState } from "@/lib/lesson-search"
import { defaultFilterValues } from "@/lib/lesson-search"

export type ActivePanel = "region" | "sport" | "date"

type LessonSearchPickerProps = Readonly<{
  initialFilters: FilterState
  submitLabel: string
  variant: "home" | "lessons"
}>

const mobilePanels = [
  ["region", "지역", MapPin],
  ["sport", "종목", Trophy],
  ["date", "일정", CalendarDays],
] as const

export function LessonSearchPicker({
  initialFilters,
  submitLabel,
  variant,
}: LessonSearchPickerProps) {
  const panelId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [activePanel, setActivePanel] = useState<ActivePanel | null>(null)
  const [filters, setFilters] = useState(initialFilters)
  const [draftFilters, setDraftFilters] = useState(initialFilters)
  const [selectedCategory, setSelectedCategory] = useState<LessonRegion | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const editingFilters = sheetOpen ? draftFilters : filters

  useEffect(() => {
    setFilters(initialFilters)
    setDraftFilters(initialFilters)
    setSelectedCategory(findRegionCategory(initialFilters.region))
  }, [initialFilters])

  const updateFilters = (nextFilters: FilterState) => {
    if (sheetOpen) {
      setDraftFilters(nextFilters)
      return
    }
    setFilters(nextFilters)
  }
  const dismissSheet = () => {
    setDraftFilters(filters)
    setSelectedCategory(findRegionCategory(filters.region))
    setSheetOpen(false)
    setActivePanel(null)
  }
  const resetDraft = () => {
    setDraftFilters(defaultFilterValues)
    setSelectedCategory(findRegionCategory(defaultFilterValues.region))
    setActivePanel("region")
  }
  const moveMobileTab = (event: KeyboardEvent<HTMLButtonElement>, panel: ActivePanel) => {
    const currentIndex = mobilePanels.findIndex(([candidate]) => candidate === panel)
    const nextIndex = {
      ArrowLeft: (currentIndex - 1 + mobilePanels.length) % mobilePanels.length,
      ArrowRight: (currentIndex + 1) % mobilePanels.length,
      End: mobilePanels.length - 1,
      Home: 0,
    }[event.key]
    if (nextIndex === undefined) return

    const nextPanel = mobilePanels[nextIndex]?.[0]
    if (!nextPanel) return
    event.preventDefault()
    setActivePanel(nextPanel)
    requestAnimationFrame(() => document.getElementById(`${panelId}-${nextPanel}-tab`)?.focus())
  }

  const regionContent =
    activePanel === "region" ? (
      <RegionSearchPanel
        onCategoryChange={setSelectedCategory}
        onSelect={(region) => updateFilters({ ...editingFilters, region })}
        selectedCategory={selectedCategory}
        selectedValue={editingFilters.region}
      />
    ) : null

  const sportContent =
    activePanel === "sport" ? (
      <SportSearchPanel
        onSelect={(sport) => updateFilters({ ...editingFilters, sport })}
        selectedValue={editingFilters.sport}
      />
    ) : null

  const dateContent = (
    <>
      {activePanel === "date" ? (
        <label className="grid gap-2 sm:max-w-xs" htmlFor={`${panelId}-date-input`}>
          <span className="text-sm font-bold text-primary">레슨 날짜</span>
          <TextInput
            aria-label="레슨 날짜"
            id={`${panelId}-date-input`}
            onChange={(event) => updateFilters({ ...editingFilters, date: event.target.value })}
            type="date"
            value={isNativeDateValue(editingFilters.date) ? editingFilters.date : ""}
          />
        </label>
      ) : null}
    </>
  )

  const filterContent = activePanel ? (
    <LessonSearchFilterContent activePanel={activePanel} key={activePanel}>
      {{ date: dateContent, region: regionContent, sport: sportContent }[activePanel]}
    </LessonSearchFilterContent>
  ) : null
  const submittedFilters = sheetOpen ? draftFilters : filters

  return (
    <form action="/lessons" className="grid gap-3" method="get">
      <input name="region" type="hidden" value={submittedFilters.region} />
      <input name="sport" type="hidden" value={submittedFilters.sport} />
      <input name="date" type="hidden" value={submittedFilters.date} />

      <div
        className={[
          "grid items-center rounded-[var(--radius-xl)] border border-line bg-canvas [box-shadow:var(--shadow-panel)] md:grid-cols-[minmax(0,1fr)_auto]",
          variant === "home" ? "md:rounded-[var(--radius-pill)]" : "",
        ].join(" ")}
      >
        <LessonSearchSummary
          activePanel={activePanel}
          filters={filters}
          onOpenDesktop={(panel) => setActivePanel((current) => (current === panel ? null : panel))}
          onOpenMobile={() => {
            setDraftFilters(filters)
            setSelectedCategory(findRegionCategory(filters.region))
            setActivePanel("region")
            setSheetOpen(true)
          }}
          panelId={panelId}
          triggerRef={triggerRef}
        />
        <button
          aria-label={submitLabel}
          className="mr-2 hidden size-12 min-h-12 items-center justify-center rounded-full bg-accent p-0 text-[var(--text-on-accent)] transition-[background-color,transform] hover:bg-[var(--accent-hover)] active:translate-y-px active:bg-[var(--accent-pressed)] md:inline-flex"
          title={submitLabel}
          type="submit"
        >
          <Search aria-hidden="true" className="size-5" strokeWidth={2} />
          <span className="sr-only">{submitLabel}</span>
        </button>
      </div>

      {activePanel && !sheetOpen ? (
        <div
          className="hidden rounded-[var(--radius-xl)] border border-line bg-canvas p-5 [box-shadow:var(--shadow-panel)] md:block"
          id={panelId}
        >
          {filterContent}
        </div>
      ) : null}

      <LessonSearchSheet
        isOpen={sheetOpen}
        onDismiss={dismissSheet}
        onReset={resetDraft}
        submitLabel="검색 적용"
        triggerRef={triggerRef}
      >
        <div
          className="grid grid-cols-3 gap-1 rounded-[var(--radius-pill)] bg-inset p-1"
          role="tablist"
        >
          {mobilePanels.map(([panel, label, Icon]) => (
            <button
              aria-controls={`${panelId}-${panel}-tabpanel`}
              aria-selected={activePanel === panel}
              className={[
                "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-pill)] px-3 text-sm font-bold",
                activePanel === panel ? "bg-canvas text-primary" : "text-secondary",
              ].join(" ")}
              data-dialog-initial-focus={panel === "region" ? "true" : undefined}
              id={`${panelId}-${panel}-tab`}
              key={panel}
              onClick={() => setActivePanel(panel)}
              onKeyDown={(event) => moveMobileTab(event, panel)}
              role="tab"
              tabIndex={activePanel === panel ? 0 : -1}
              type="button"
            >
              <Icon aria-hidden="true" className="size-4 text-accent" strokeWidth={1.8} />
              {label}
            </button>
          ))}
        </div>
        {activePanel ? (
          <div
            aria-labelledby={`${panelId}-${activePanel}-tab`}
            id={`${panelId}-${activePanel}-tabpanel`}
            role="tabpanel"
          >
            {filterContent}
          </div>
        ) : null}
      </LessonSearchSheet>
    </form>
  )
}

function findRegionCategory(value: string): LessonRegion | null {
  return lessonRegions.find((category) => value.startsWith(category.queryValue)) ?? null
}

function isNativeDateValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value)
}
