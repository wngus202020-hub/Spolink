import { ArrowRight, CalendarDays, CreditCard, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { Lesson } from "@/lib/home-data"

type LessonBookingPanelProps = Readonly<{
  lesson: Lesson
}>

export function LessonBookingPanel({ lesson }: LessonBookingPanelProps) {
  const firstValidScheduleIndex = lesson.schedules.findIndex(
    (schedule) =>
      schedule.isOpen !== false &&
      (schedule.remainingCount === undefined || schedule.remainingCount > 0),
  )

  return (
    <form
      action={`/lessons/${lesson.id}/booking`}
      className="grid h-fit gap-5 rounded-[var(--radius-xl)] border border-line bg-canvas p-6 [box-shadow:var(--shadow-panel)] lg:sticky lg:top-6"
      method="get"
    >
      <div className="grid gap-1">
        <span className="text-sm text-secondary">1회 수업</span>
        <strong className="text-3xl font-bold text-primary">{lesson.priceText}</strong>
        <span className="text-sm text-secondary">{lesson.durationText}</span>
      </div>

      <fieldset className="grid gap-3">
        <legend className="inline-flex items-center gap-2 text-sm font-bold text-primary">
          <CalendarDays aria-hidden="true" className="size-4 text-accent" strokeWidth={1.8} />
          예약 가능 일정
        </legend>
        <div className="grid gap-2">
          {lesson.schedules.map((schedule, index) => {
            const isValidSchedule =
              schedule.isOpen !== false &&
              (schedule.remainingCount === undefined || schedule.remainingCount > 0)

            return (
              <label
                aria-disabled={!isValidSchedule}
                className={[
                  "flex min-h-14 items-center justify-between gap-3 rounded-[var(--radius-md)] border border-line bg-inset px-4 py-3",
                  isValidSchedule ? "" : "opacity-70",
                ].join(" ")}
                key={schedule.id}
              >
                <span className="flex items-center gap-3">
                  <input
                    defaultChecked={index === firstValidScheduleIndex}
                    disabled={!isValidSchedule}
                    name="scheduleId"
                    type="radio"
                    value={schedule.id}
                  />
                  <span className={isValidSchedule ? "font-bold text-primary" : "text-tertiary"}>
                    {schedule.label}
                  </span>
                </span>
                <span
                  className={isValidSchedule ? "text-sm text-secondary" : "text-sm text-tertiary"}
                >
                  {schedule.capacityText}
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="grid gap-3 border-t border-line pt-4 text-sm text-secondary">
        <span className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2">
            <Users aria-hidden="true" className="size-4" strokeWidth={1.8} />
            정원
          </span>
          <strong className="text-primary">{lesson.capacityText}</strong>
        </span>
        <span className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2">
            <CreditCard aria-hidden="true" className="size-4" strokeWidth={1.8} />
            결제 예정 금액
          </span>
          <strong className="text-primary">{lesson.priceText}</strong>
        </span>
      </div>

      <Button disabled={firstValidScheduleIndex === -1} type="submit">
        예약 확인
        <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
      </Button>

      <p className="m-0 grid gap-1 text-sm leading-[1.6] text-secondary">
        <span>{lesson.refundSummary}.</span>
        <span>결제 전에는 임시 선택이에요.</span>
      </p>
    </form>
  )
}
