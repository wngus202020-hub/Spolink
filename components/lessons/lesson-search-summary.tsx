import { CalendarDays, type LucideIcon, MapPin, Search, Trophy } from "lucide-react"
import type { RefObject } from "react"
import type { ActivePanel } from "@/components/lessons/lesson-search-picker"
import type { FilterState } from "@/lib/lesson-search"

type LessonSearchSummaryProps = Readonly<{
  activePanel: ActivePanel | null
  filters: FilterState
  onOpenDesktop: (panel: ActivePanel) => void
  onOpenMobile: () => void
  panelId: string
  triggerRef: RefObject<HTMLButtonElement | null>
}>

const segments = [
  { icon: MapPin, label: "지역", panel: "region" },
  { icon: Trophy, label: "종목", panel: "sport" },
  { icon: CalendarDays, label: "일정", panel: "date" },
] as const

export function LessonSearchSummary({
  activePanel,
  filters,
  onOpenDesktop,
  onOpenMobile,
  panelId,
  triggerRef,
}: LessonSearchSummaryProps) {
  const values = {
    date: filters.date || "날짜 선택",
    region: filters.region || "지역 선택",
    sport: filters.sport || "전체 종목",
  } satisfies Record<ActivePanel, string>
  const compactSummary = `${values.region} · ${values.sport} · ${values.date}`

  return (
    <>
      <button
        aria-label={`검색 조건: ${compactSummary}. 열기`}
        className="flex min-h-14 min-w-0 items-center gap-3 rounded-[var(--radius-xl)] px-4 text-left md:hidden"
        onClick={onOpenMobile}
        ref={triggerRef}
        type="button"
      >
        <Search aria-hidden="true" className="size-5 shrink-0 text-accent" strokeWidth={2} />
        <span className="grid min-w-0 gap-0.5">
          <span className="text-xs font-bold text-primary">레슨 검색</span>
          <span className="truncate text-sm text-secondary">{compactSummary}</span>
        </span>
      </button>

      <div className="hidden min-w-0 grid-cols-3 md:grid" data-testid="desktop-search-segments">
        {segments.map(({ icon, label, panel }, index) => (
          <SummarySegment
            icon={icon}
            isDivided={index < segments.length - 1}
            isOpen={activePanel === panel}
            key={panel}
            label={label}
            onOpen={() => onOpenDesktop(panel)}
            panelId={panelId}
            value={values[panel]}
          />
        ))}
      </div>
    </>
  )
}

function SummarySegment({
  icon: Icon,
  isDivided,
  isOpen,
  label,
  onOpen,
  panelId,
  value,
}: Readonly<{
  icon: LucideIcon
  isDivided: boolean
  isOpen: boolean
  label: string
  onOpen: () => void
  panelId: string
  value: string
}>) {
  return (
    <button
      aria-controls={panelId}
      aria-expanded={isOpen}
      aria-label={`${label}: ${value}. 선택하기`}
      className={[
        "flex min-h-14 min-w-0 items-center gap-3 px-4 text-left transition-colors hover:bg-inset",
        isDivided ? "border-r border-line-subtle" : "",
      ].join(" ")}
      data-search-segment="true"
      onClick={onOpen}
      type="button"
    >
      <Icon aria-hidden="true" className="size-5 shrink-0 text-accent" strokeWidth={1.8} />
      <span className="grid min-w-0 gap-0.5">
        <span className="text-xs font-bold text-primary">{label}</span>
        <span className="truncate text-sm text-secondary">{value}</span>
      </span>
    </button>
  )
}
