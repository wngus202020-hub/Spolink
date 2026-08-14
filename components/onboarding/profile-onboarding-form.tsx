"use client"

import { ArrowRight } from "lucide-react"
import { useRouter } from "next/navigation"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { useHydrated } from "@/components/auth/auth-client-routes"
import { AuthAlert, AuthTextField } from "@/components/auth/auth-fields"
import { Button } from "@/components/ui/button"

type FieldName = "defaultRegion" | "displayName" | "phone" | "realName"
type FieldErrors = Partial<Record<FieldName | "form", string>>
type OnboardingIntent = "coach" | "learner"

const phonePattern = /^01[016789]-[0-9]{3,4}-[0-9]{4}$/

export function ProfileOnboardingForm() {
  const hydrated = useHydrated()
  const router = useRouter()
  const alertRef = useRef<HTMLDivElement>(null)
  const submittingRef = useRef(false)
  const refs = {
    defaultRegion: useRef<HTMLInputElement>(null),
    displayName: useRef<HTMLInputElement>(null),
    phone: useRef<HTMLInputElement>(null),
    realName: useRef<HTMLInputElement>(null),
  }
  const [errors, setErrors] = useState<FieldErrors>({})
  const [intent, setIntent] = useState<OnboardingIntent>("learner")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (errors.form) alertRef.current?.focus()
  }, [errors.form])

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current) return

    const form = new FormData(event.currentTarget)
    const request = {
      defaultRegion: String(form.get("defaultRegion") ?? "").trim(),
      displayName: String(form.get("displayName") ?? "").trim(),
      locationAgreed: form.get("locationAgreed") === "on",
      marketingAgreed: form.get("marketingAgreed") === "on",
      phone: String(form.get("phone") ?? "").trim(),
      realName: String(form.get("realName") ?? "").trim(),
    }
    const validationErrors = validateProfile(request)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      focusFirstInvalid(refs, validationErrors)
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    setErrors({})
    try {
      const response = await fetch("/api/profiles", {
        body: JSON.stringify(request),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      if (response.status === 201) {
        await response.text()
        router.replace(intent === "coach" ? "/coach/apply" : "/lessons")
        return
      }

      const errorCode = await readErrorCode(response)
      if (response.status === 409 && errorCode === "PROFILE_ALREADY_EXISTS") {
        router.replace(intent === "coach" ? "/coach/apply" : "/lessons")
        return
      }
      if (response.status === 401) {
        router.replace("/auth/login?next=/onboarding/profile")
        return
      }
      if (response.status === 403) {
        if (errorCode === "ACCOUNT_DELETED") {
          router.replace("/auth/restricted?reason=account-deleted")
          return
        }
        if (errorCode === "ACCOUNT_SUSPENDED") {
          router.replace("/auth/restricted?reason=account-suspended")
          return
        }
      }
      setErrors({ form: profileErrorMessage(response.status) })
    } catch {
      setErrors({ form: "연결이 원활하지 않아요. 잠시 후 다시 시도해요." })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <form className="grid gap-5" method="post" noValidate onSubmit={submitProfile}>
      {errors.form ? (
        <AuthAlert alertRef={alertRef} tabIndex={-1} tone="error">
          {errors.form}
        </AuthAlert>
      ) : null}

      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-lg font-bold text-primary">기본 프로필</h2>
          <span className="rounded-[var(--radius-pill)] bg-accent-soft px-3 py-1 text-xs font-bold text-accent">
            모두 필수
          </span>
        </div>
        <p className="m-0 text-sm leading-relaxed text-secondary">
          레슨 이용과 계정 확인에 필요한 정보를 입력해요.
        </p>
        <div className="grid gap-4">
          <AuthTextField
            error={errors.displayName}
            helperText="다른 이용자에게 공개되는 이름이에요."
            id="profile-display-name"
            inputRef={refs.displayName}
            label="활동 이름 (필수)"
            maxLength={30}
            name="displayName"
            required
          />
          <AuthTextField
            autoComplete="name"
            error={errors.realName}
            helperText="계정 확인을 위해 사용하는 실명이에요."
            id="profile-real-name"
            inputRef={refs.realName}
            label="실명 (필수)"
            maxLength={50}
            name="realName"
            required
          />
          <AuthTextField
            autoComplete="tel"
            error={errors.phone}
            helperText="예약 등 서비스 안내에 사용해요. 예: 010-1234-5678"
            id="profile-phone"
            inputMode="tel"
            inputRef={refs.phone}
            label="휴대폰 번호 (필수)"
            name="phone"
            required
          />
          <AuthTextField
            error={errors.defaultRegion}
            helperText="가까운 레슨을 찾는 데 사용하는 시·군·구예요."
            id="profile-region"
            inputRef={refs.defaultRegion}
            label="기본 활동 지역 (필수)"
            maxLength={80}
            name="defaultRegion"
            required
          />
        </div>
      </div>

      <fieldset className="grid gap-3 border-t border-line pt-5">
        <legend className="pr-3 text-base font-bold text-primary">이용 목적</legend>
        <p className="m-0 text-sm text-secondary">
          이용 목적은 저장 후 이동할 화면만 정하며 계정 권한이나 상태를 변경하지 않아요.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <IntentChoice
            checked={intent === "learner"}
            description="내 주변 레슨을 찾고 예약해요."
            label="레슨 배우기"
            onChange={() => setIntent("learner")}
            value="learner"
          />
          <IntentChoice
            checked={intent === "coach"}
            description="프로필 저장 후 지도자 등록 절차를 확인해요."
            label="지도자 등록 알아보기"
            onChange={() => setIntent("coach")}
            value="coach"
          />
        </div>
      </fieldset>

      <fieldset className="grid gap-3 border-t border-line pt-5">
        <legend className="pr-3 text-base font-bold text-primary">선택 동의</legend>
        <p className="m-0 text-sm text-secondary">동의하지 않아도 프로필을 만들 수 있어요.</p>
        <div className="grid gap-3 rounded-[var(--radius-md)] bg-inset p-4 text-sm text-secondary">
          <Consent name="locationAgreed">내 주변 레슨 안내를 위한 위치 이용에 동의해요.</Consent>
          <Consent name="marketingAgreed">혜택과 새로운 레슨 소식 수신에 동의해요.</Consent>
        </div>
      </fieldset>

      <Button className="w-full" disabled={!hydrated || submitting} type="submit">
        {submitting ? "저장 중" : intent === "coach" ? "지도자 등록으로 이동" : "레슨 찾기 시작"}
        <ArrowRight aria-hidden="true" className="size-4" />
      </Button>
    </form>
  )
}

function IntentChoice({
  checked,
  description,
  label,
  onChange,
  value,
}: Readonly<{
  checked: boolean
  description: string
  label: string
  onChange: () => void
  value: OnboardingIntent
}>) {
  const descriptionId = `profile-intent-${value}-description`

  return (
    <label
      className={[
        "flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border px-4 py-3 text-primary",
        checked ? "border-accent bg-accent-soft" : "border-line bg-canvas",
      ].join(" ")}
    >
      <input
        aria-describedby={descriptionId}
        aria-label={label}
        className="size-5 accent-[var(--accent-primary)]"
        checked={checked}
        name="intent"
        onChange={onChange}
        type="radio"
        value={value}
      />
      <span className="grid gap-1">
        <span className="font-bold">{label}</span>
        <span className="text-sm font-medium leading-normal text-secondary" id={descriptionId}>
          {description}
        </span>
      </span>
    </label>
  )
}

function Consent({ children, name }: Readonly<{ children: string; name: string }>) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3">
      <input className="mt-0.5 size-5 accent-[var(--accent-primary)]" name={name} type="checkbox" />
      <span>{children}</span>
    </label>
  )
}

function validateProfile(
  value: Readonly<{ defaultRegion: string; displayName: string; phone: string; realName: string }>,
): FieldErrors {
  const errors: FieldErrors = {}
  if (value.displayName.length < 2) errors.displayName = "활동 이름은 2자 이상 입력하면 돼요."
  if (value.realName.length < 2) errors.realName = "실명은 2자 이상 입력하면 돼요."
  if (!phonePattern.test(value.phone)) errors.phone = "올바른 휴대폰 번호를 입력해요."
  if (value.defaultRegion.length < 2) errors.defaultRegion = "활동 지역은 2자 이상 입력하면 돼요."
  return errors
}

function focusFirstInvalid(
  refs: Record<FieldName, { current: HTMLInputElement | null }>,
  errors: FieldErrors,
) {
  for (const name of ["displayName", "realName", "phone", "defaultRegion"] as const) {
    if (errors[name]) {
      refs[name].current?.focus()
      return
    }
  }
}

async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const payload: unknown = await response.json()
    if (!isRecord(payload) || !isRecord(payload["error"])) return null
    return typeof payload["error"]["code"] === "string" ? payload["error"]["code"] : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function profileErrorMessage(responseStatus: number) {
  if (responseStatus === 422) return "입력 내용을 다시 확인해요."
  if (responseStatus === 500) {
    return "서버에서 프로필을 저장하지 못했어요. 잠시 후 다시 시도해요."
  }
  if (responseStatus === 503) {
    return "프로필 저장 서비스를 잠시 사용할 수 없어요. 잠시 후 다시 시도해요."
  }
  return "프로필을 저장하지 못했어요. 잠시 후 다시 시도해요."
}
