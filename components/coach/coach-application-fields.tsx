import type { ChangeEvent } from "react"
import { SelectInput, TextareaInput, TextInput } from "@/components/ui/form-controls"

export type CoachFormState = Readonly<{
  bankAccountLast4: string
  bankName: string
  bio: string
  careerYears: string
  headline: string
  payoutHolderName: string
  primarySportId: string
  serviceRegion: string
}>

export function CoachApplicationFields({
  editable,
  onChange,
  sports,
  value,
}: Readonly<{
  editable: boolean
  onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void
  sports: readonly Readonly<{ id: string; name: string }>[]
  value: CoachFormState
}>) {
  return (
    <div className="grid gap-6">
      <section
        aria-labelledby="application-info-heading"
        className="grid gap-5 border-b border-line pb-6"
      >
        <div className="grid gap-1">
          <h2 className="m-0 text-2xl font-bold text-primary" id="application-info-heading">
            신청 정보
          </h2>
          <p className="m-0 text-sm text-secondary">지도자 소개와 실제 활동 범위를 입력해요.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="한 줄 소개" name="headline">
            <TextInput
              disabled={!editable}
              id="headline"
              maxLength={120}
              name="headline"
              onChange={onChange}
              readOnly={!editable}
              required
              value={value.headline}
            />
          </Field>
          <Field label="대표 종목" name="primarySportId">
            <SelectInput
              disabled={!editable}
              id="primarySportId"
              name="primarySportId"
              onChange={onChange}
              required
              value={value.primarySportId}
            >
              <option value="">종목 선택</option>
              {sports.map((sport) => (
                <option key={sport.id} value={sport.id}>
                  {sport.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="활동 지역" name="serviceRegion">
            <TextInput
              disabled={!editable}
              id="serviceRegion"
              maxLength={100}
              name="serviceRegion"
              onChange={onChange}
              readOnly={!editable}
              required
              value={value.serviceRegion}
            />
          </Field>
          <Field label="경력 연수" name="careerYears">
            <TextInput
              disabled={!editable}
              id="careerYears"
              max={100}
              min={0}
              name="careerYears"
              onChange={onChange}
              readOnly={!editable}
              required
              type="number"
              value={value.careerYears}
            />
          </Field>
          <Field className="sm:col-span-2" label="소개글" name="bio">
            <TextareaInput
              disabled={!editable}
              id="bio"
              maxLength={5000}
              name="bio"
              onChange={onChange}
              readOnly={!editable}
              required
              value={value.bio}
            />
          </Field>
        </div>
      </section>
      <section aria-labelledby="payout-heading" className="grid gap-5">
        <div className="grid gap-1">
          <h2 className="m-0 text-2xl font-bold text-primary" id="payout-heading">
            정산 정보
          </h2>
          <p className="m-0 text-sm text-secondary">
            전체 계좌번호는 저장하지 않고 확인용 요약만 받아요.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="은행명" name="bankName">
            <TextInput
              disabled={!editable}
              id="bankName"
              maxLength={100}
              name="bankName"
              onChange={onChange}
              readOnly={!editable}
              required
              value={value.bankName}
            />
          </Field>
          <Field label="계좌 끝 4자리" name="bankAccountLast4">
            <TextInput
              disabled={!editable}
              id="bankAccountLast4"
              inputMode="numeric"
              maxLength={4}
              name="bankAccountLast4"
              onChange={onChange}
              pattern="[0-9]{4}"
              readOnly={!editable}
              required
              value={value.bankAccountLast4}
            />
          </Field>
          <Field label="예금주" name="payoutHolderName">
            <TextInput
              disabled={!editable}
              id="payoutHolderName"
              maxLength={100}
              name="payoutHolderName"
              onChange={onChange}
              readOnly={!editable}
              required
              value={value.payoutHolderName}
            />
          </Field>
        </div>
      </section>
    </div>
  )
}

function Field({
  children,
  className = "",
  label,
  name,
}: Readonly<{ children: React.ReactNode; className?: string; label: string; name: string }>) {
  return (
    <label className={`grid gap-2 ${className}`} htmlFor={name}>
      <span className="text-sm font-bold text-primary">{label}</span>
      {children}
    </label>
  )
}
