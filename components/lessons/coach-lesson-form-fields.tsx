import type { LessonDraftInput } from "@/lib/lessons/authoring-contract"

export type CoachLessonSportOption = Readonly<{ id: string; name: string }>
export type CoachLessonFieldValues = Readonly<{
  address: string | null
  cancellationPolicySummary: string | null
  capacity: number
  description: string
  durationMinutes: number
  placeName: string | null
  preparation: string | null
  priceAmount: number
  region: string
  sportId: string
  summary: string | null
  title: string
}>

export const lessonInputClassName =
  "min-h-11 rounded-[var(--radius-md)] border border-line bg-canvas px-3 py-2 text-primary disabled:bg-inset disabled:text-tertiary"

export function LessonField({
  disabled = false,
  label,
  name,
  required = false,
  type = "text",
  value,
}: Readonly<{
  disabled?: boolean
  label: string
  name: string
  required?: boolean
  type?: "number" | "text"
  value: number | string | null | undefined
}>) {
  return (
    <label className="grid gap-2 text-sm font-bold text-primary">
      {label}
      <input
        className={lessonInputClassName}
        defaultValue={value ?? ""}
        disabled={disabled}
        name={name}
        required={required}
        type={type}
      />
    </label>
  )
}

export function CoachLessonFormFields({
  disabled,
  initial,
  sports,
}: Readonly<{
  disabled: boolean
  initial: CoachLessonFieldValues | undefined
  sports: readonly CoachLessonSportOption[]
}>) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <LessonField
          disabled={disabled}
          label="레슨 제목"
          name="title"
          required
          value={initial?.title}
        />
        <label className="grid gap-2 text-sm font-bold text-primary">
          종목
          <select
            className={lessonInputClassName}
            defaultValue={initial?.sportId ?? ""}
            disabled={disabled}
            name="sportId"
            required
          >
            <option disabled value="">
              종목 선택
            </option>
            {sports.map((sport) => (
              <option key={sport.id} value={sport.id}>
                {sport.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <LessonField disabled={disabled} label="한 줄 요약" name="summary" value={initial?.summary} />
      <label className="grid gap-2 text-sm font-bold text-primary">
        상세 설명
        <textarea
          className={`${lessonInputClassName} min-h-36 resize-y`}
          defaultValue={initial?.description}
          disabled={disabled}
          name="description"
          required
        />
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <LessonField
          disabled={disabled}
          label="지역"
          name="region"
          required
          value={initial?.region}
        />
        <LessonField
          disabled={disabled}
          label="장소명"
          name="placeName"
          value={initial?.placeName}
        />
        <LessonField
          disabled={disabled}
          label="상세 주소"
          name="address"
          value={initial?.address}
        />
        <LessonField
          disabled={disabled}
          label="준비물"
          name="preparation"
          value={initial?.preparation}
        />
        <LessonField
          disabled={disabled}
          label="수업 시간(분)"
          name="durationMinutes"
          required
          type="number"
          value={initial?.durationMinutes ?? 60}
        />
        <LessonField
          disabled={disabled}
          label="가격(원)"
          name="priceAmount"
          required
          type="number"
          value={initial?.priceAmount ?? 0}
        />
        <LessonField
          disabled={disabled}
          label="기본 정원"
          name="capacity"
          required
          type="number"
          value={initial?.capacity ?? 1}
        />
        <LessonField
          disabled={disabled}
          label="취소 정책 요약"
          name="cancellationPolicySummary"
          value={initial?.cancellationPolicySummary}
        />
      </div>
    </>
  )
}

export function readLessonDraftForm(form: FormData): LessonDraftInput {
  return {
    address: optional(form, "address"),
    cancellationPolicySummary: optional(form, "cancellationPolicySummary"),
    capacity: number(form, "capacity"),
    description: text(form, "description"),
    durationMinutes: number(form, "durationMinutes"),
    placeName: optional(form, "placeName"),
    preparation: optional(form, "preparation"),
    priceAmount: number(form, "priceAmount"),
    region: text(form, "region"),
    sportId: text(form, "sportId"),
    summary: optional(form, "summary"),
    title: text(form, "title"),
  }
}

function text(form: FormData, name: string) {
  const value = form.get(name)
  return typeof value === "string" ? value : ""
}

function optional(form: FormData, name: string) {
  const value = text(form, name).trim()
  return value || null
}

function number(form: FormData, name: string) {
  return Number(text(form, name))
}
