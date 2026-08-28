"use client"

import { CalendarPlus, LockKeyhole } from "lucide-react"
import { useRouter } from "next/navigation"
import { type FormEvent, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  closeLessonSchedule,
  createLessonSchedule,
  updateLessonSchedule,
} from "@/lib/lessons/authoring-client"
import type { ScheduleAuthoringData } from "@/lib/lessons/authoring-types"

type CoachScheduleManagerProps = Readonly<{
  canMutate: boolean
  lessonId: string
  schedules: readonly ScheduleAuthoringData[]
}>

export function CoachScheduleManager({
  canMutate,
  lessonId,
  schedules,
}: CoachScheduleManagerProps) {
  const router = useRouter()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [message, setMessage] = useState<Readonly<{
    kind: "error" | "success"
    text: string
  }> | null>(null)
  const alertRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (message?.kind === "error") alertRef.current?.focus()
  }, [message])

  async function createSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const startsAt = toIso(form.get("startsAt"))
    const endsAt = toIso(form.get("endsAt"))
    const capacity = Number(form.get("capacity"))
    if (!startsAt || !endsAt) {
      setMessage({ kind: "error", text: "시작과 종료 시간을 확인해 주세요." })
      return
    }
    setBusyKey("create")
    setMessage(null)
    const result = await createLessonSchedule(lessonId, { capacity, endsAt, startsAt })
    finish(result, "일정을 추가했습니다.")
  }

  async function updateSchedule(
    event: FormEvent<HTMLFormElement>,
    schedule: ScheduleAuthoringData,
  ) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const startsAt = toIso(form.get("startsAt"))
    const endsAt = toIso(form.get("endsAt"))
    const capacity = Number(form.get("capacity"))
    if (!startsAt || !endsAt) {
      setMessage({ kind: "error", text: "시작과 종료 시간을 확인해 주세요." })
      return
    }
    setBusyKey(schedule.id)
    setMessage(null)
    const result = await updateLessonSchedule(lessonId, schedule.id, {
      capacity,
      endsAt,
      expectedUpdatedAt: schedule.updatedAt,
      startsAt,
    })
    finish(result, "일정을 수정했습니다.")
  }

  async function closeSchedule(schedule: ScheduleAuthoringData) {
    setBusyKey(schedule.id)
    setMessage(null)
    const result = await closeLessonSchedule(lessonId, schedule.id, {
      expectedUpdatedAt: schedule.updatedAt,
    })
    finish(result, "일정을 닫았습니다.")
  }

  function finish(
    result:
      | Readonly<{ data: ScheduleAuthoringData; status: "success" }>
      | Readonly<{ message: string; status: "failure" }>,
    successMessage: string,
  ) {
    setBusyKey(null)
    if (result.status === "failure") {
      setMessage({ kind: "error", text: result.message })
      return
    }
    setMessage({ kind: "success", text: successMessage })
    router.refresh()
  }

  return (
    <div className="grid gap-8">
      {message ? (
        <p
          aria-live={message.kind === "error" ? "assertive" : "polite"}
          className="m-0 rounded-[var(--radius-md)] bg-inset p-4 text-sm text-primary"
          ref={alertRef}
          role={message.kind === "error" ? "alert" : "status"}
          tabIndex={message.kind === "error" ? -1 : undefined}
        >
          {message.text}
        </p>
      ) : null}

      <form className="grid gap-4 border-b border-line pb-8" onSubmit={createSchedule}>
        <div className="flex items-center gap-2">
          <CalendarPlus aria-hidden="true" className="size-5 text-accent" />
          <h2 className="m-0 text-xl font-bold text-primary">새 일정</h2>
        </div>
        {!canMutate ? (
          <p className="m-0 text-sm text-secondary">
            검토 중이거나 종료된 레슨에는 일정을 추가할 수 없습니다.
          </p>
        ) : null}
        <ScheduleFields disabled={!canMutate || busyKey !== null} />
        <Button className="w-fit" disabled={!canMutate || busyKey !== null} type="submit">
          {busyKey === "create" ? "추가 중…" : "일정 추가"}
        </Button>
      </form>

      <section aria-labelledby="schedule-list-heading" className="grid gap-4">
        <div>
          <h2 className="m-0 text-xl font-bold text-primary" id="schedule-list-heading">
            등록된 일정
          </h2>
          <p className="m-0 mt-1 text-sm leading-6 text-secondary">
            확정 예약이 있는 일정은 시간과 정원을 변경할 수 없지만 닫을 수 있어요.
          </p>
        </div>
        {schedules.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] bg-subtle p-6">
            <p className="m-0 font-bold text-primary">아직 등록된 일정이 없습니다.</p>
            <p className="m-0 mt-1 text-sm text-secondary">첫 예약 가능 시간을 추가해 주세요.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {schedules.map((schedule) => (
              <form
                className="grid gap-4 border-b border-line py-5 first:pt-0"
                key={schedule.id}
                onSubmit={(event) => updateSchedule(event, schedule)}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <strong className="text-primary">
                    {schedule.isOpen ? "예약 가능" : "닫힌 일정"}
                  </strong>
                  <span className="inline-flex items-center gap-1 text-sm text-secondary">
                    <LockKeyhole aria-hidden="true" className="size-4" />
                    예약 {schedule.reservedCount}/{schedule.capacity}
                  </span>
                </div>
                <ScheduleFields
                  disabled={!canMutate || !schedule.isOpen || busyKey !== null}
                  schedule={schedule}
                />
                <div className="flex flex-wrap gap-3">
                  <Button
                    disabled={!canMutate || !schedule.isOpen || busyKey !== null}
                    type="submit"
                  >
                    {busyKey === schedule.id ? "처리 중…" : "수정 저장"}
                  </Button>
                  <Button
                    disabled={!canMutate || !schedule.isOpen || busyKey !== null}
                    onClick={() => closeSchedule(schedule)}
                    type="button"
                    variant="outline"
                  >
                    일정 닫기
                  </Button>
                </div>
              </form>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ScheduleFields({
  disabled,
  schedule,
}: Readonly<{ disabled: boolean; schedule?: ScheduleAuthoringData }>) {
  const inputClassName =
    "min-h-11 rounded-[var(--radius-md)] border border-line bg-canvas px-3 py-2 text-primary disabled:bg-inset disabled:text-tertiary"
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <label className="grid gap-2 text-sm font-bold text-primary">
        시작
        <input
          className={inputClassName}
          defaultValue={schedule ? toKstInput(schedule.startsAt) : undefined}
          disabled={disabled}
          name="startsAt"
          required
          type="datetime-local"
        />
      </label>
      <label className="grid gap-2 text-sm font-bold text-primary">
        종료
        <input
          className={inputClassName}
          defaultValue={schedule ? toKstInput(schedule.endsAt) : undefined}
          disabled={disabled}
          name="endsAt"
          required
          type="datetime-local"
        />
      </label>
      <label className="grid gap-2 text-sm font-bold text-primary">
        정원
        <input
          className={inputClassName}
          defaultValue={schedule?.capacity ?? 1}
          disabled={disabled}
          max={100}
          min={1}
          name="capacity"
          required
          type="number"
        />
      </label>
    </div>
  )
}

function toIso(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.length === 0) return null
  const parsed = new Date(`${value}:00+09:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function toKstInput(value: string) {
  const date = new Date(Date.parse(value) + 9 * 60 * 60 * 1000)
  return date.toISOString().slice(0, 16)
}
