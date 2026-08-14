import { CalendarDays, Check, MapPin, Trophy } from "lucide-react"
import type { ReactNode } from "react"
import type { ActivePanel } from "@/components/lessons/lesson-search-picker"

type LessonSearchFilterContentProps = Readonly<{
  activePanel: ActivePanel
  children: ReactNode
}>

const panelDetails = {
  date: {
    description: "레슨을 찾을 날짜를 골라요.",
    icon: CalendarDays,
    title: "언제 운동할까요?",
  },
  region: {
    description: "시·도를 고른 뒤 시·군·구를 선택해요.",
    icon: MapPin,
    title: "어디에서 운동할까요?",
  },
  sport: {
    description: "원하는 종목을 골라요.",
    icon: Trophy,
    title: "어떤 운동을 찾을까요?",
  },
} as const

export function LessonSearchFilterContent({
  activePanel,
  children,
}: LessonSearchFilterContentProps) {
  const detail = panelDetails[activePanel]
  const Icon = detail.icon

  return (
    <section className="grid gap-4" role="tabpanel">
      <div className="grid gap-1">
        <h2 className="m-0 inline-flex items-center gap-2 text-lg font-bold text-primary">
          <Icon aria-hidden="true" className="size-5 text-accent" strokeWidth={1.8} />
          {detail.title}
        </h2>
        <p className="m-0 text-sm text-secondary">{detail.description}</p>
      </div>
      {children}
    </section>
  )
}

export function ChoiceButton({
  isSelected,
  label,
  onSelect,
}: Readonly<{
  isSelected: boolean
  label: string
  onSelect: () => void
}>) {
  return (
    <button
      aria-pressed={isSelected}
      className={[
        "inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[var(--radius-pill)] border px-3 text-center text-sm font-bold transition-colors",
        isSelected
          ? "border-accent bg-accent-soft text-primary"
          : "border-line bg-canvas text-secondary hover:border-secondary hover:text-primary",
      ].join(" ")}
      onClick={onSelect}
      type="button"
    >
      {isSelected ? <Check aria-hidden="true" className="size-4" strokeWidth={2} /> : null}
      {label}
    </button>
  )
}
