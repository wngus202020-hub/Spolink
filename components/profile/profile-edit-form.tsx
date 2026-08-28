"use client"

import { Save } from "lucide-react"
import { useRouter } from "next/navigation"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { AuthAlert, AuthTextField } from "@/components/auth/auth-fields"
import { Button } from "@/components/ui/button"
import { type ProfileEditClientResult, patchCurrentProfile } from "@/lib/profile/edit-client"
import {
  buildProfileEditPatch,
  type ProfileEditInitialData,
  parseProfileEditForm,
} from "@/lib/profile/edit-contract"
import { ProfileEditConsent } from "./profile-edit-consent"
import {
  buildFieldErrors,
  draftFromInitial,
  draftHasPotentialChanges,
  focusFirstFieldError,
  type ProfileEditDraftValues,
  type ProfileEditFieldErrors,
  type ProfileEditRefs,
  type ProfileEditSubmit,
  profileEditFailureMessage,
  submitProfileEditOnEnter,
} from "./profile-edit-form-state"
import { ProfileRegionPicker } from "./profile-region-picker"

type ProfileEditFormProps = Readonly<{
  initialProfile: ProfileEditInitialData
  submitProfileEdit?: ProfileEditSubmit
}>

export function ProfileEditForm({
  initialProfile,
  submitProfileEdit = patchCurrentProfile,
}: ProfileEditFormProps) {
  const router = useRouter()
  const alertRef = useRef<HTMLDivElement>(null)
  const submittingRef = useRef(false)
  const refs: ProfileEditRefs = {
    defaultRegion: useRef<HTMLInputElement>(null),
    displayName: useRef<HTMLInputElement>(null),
    phone: useRef<HTMLInputElement>(null),
    realName: useRef<HTMLInputElement>(null),
  }
  const [baseline, setBaseline] = useState(initialProfile)
  const [fieldErrors, setFieldErrors] = useState<ProfileEditFieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState("")
  const [values, setValues] = useState<ProfileEditDraftValues>(() =>
    draftFromInitial(initialProfile),
  )

  const parsedDraft = parseProfileEditForm(values)
  const canSubmit =
    parsedDraft.status === "success" && draftHasPotentialChanges(baseline, values) && !submitting

  useEffect(() => {
    if (formError) alertRef.current?.focus()
  }, [formError])

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current) return

    const parsedValues = parseProfileEditForm(values)
    if (parsedValues.status === "failure") {
      const nextFieldErrors = buildFieldErrors(parsedValues.fields)
      setSuccessMessage("")
      setFormError(null)
      setFieldErrors(nextFieldErrors)
      focusFirstFieldError(refs, nextFieldErrors)
      return
    }

    const nextPatch = buildProfileEditPatch(baseline, parsedValues.values)
    if (nextPatch === null) return

    submittingRef.current = true
    setSubmitting(true)
    setFieldErrors({})
    setFormError(null)
    setSuccessMessage("")
    const result = await submitProfileEdit(nextPatch)
    submittingRef.current = false
    setSubmitting(false)
    handleResult(result)
  }

  function handleResult(result: ProfileEditClientResult) {
    if (result.status === "success") {
      setBaseline(result.baseline)
      setValues(draftFromInitial(result.baseline))
      setSuccessMessage("프로필 정보를 저장했어요.")
      router.refresh()
      return
    }
    if (result.status === "no_changes") return
    if (result.category === "login" || result.category === "onboarding") {
      router.replace(result.destination)
      return
    }
    if (result.category === "restricted") {
      router.replace(result.destination)
      return
    }
    setFormError(profileEditFailureMessage(result))
  }

  function updateText(field: "displayName" | "phone" | "realName", value: string) {
    updateValues((current) => ({ ...current, [field]: value }))
  }

  function updateConsent(field: "locationAgreed" | "marketingAgreed", checked: boolean) {
    updateValues((current) => ({ ...current, [field]: checked }))
  }

  function updateRegion(value: string) {
    updateValues((current) => ({ ...current, defaultRegion: value }))
  }

  function updateValues(update: (current: ProfileEditDraftValues) => ProfileEditDraftValues) {
    setValues((current) => {
      const nextValues = update(current)
      clearFeedback(nextValues)
      return nextValues
    })
  }

  function clearFeedback(nextValues: ProfileEditDraftValues) {
    if (successMessage) setSuccessMessage("")
    if (formError) setFormError(null)
    if (Object.keys(fieldErrors).length > 0) {
      const nextParsed = parseProfileEditForm(nextValues)
      setFieldErrors(nextParsed.status === "failure" ? buildFieldErrors(nextParsed.fields) : {})
    }
  }

  return (
    <form className="grid gap-6" method="post" noValidate onSubmit={submitProfile}>
      {formError ? (
        <AuthAlert alertRef={alertRef} tabIndex={-1} tone="error">
          <span id="profile-edit-alert">{formError}</span>
        </AuthAlert>
      ) : null}
      {successMessage ? (
        <p
          aria-live="polite"
          className="m-0 rounded-[var(--radius-md)] border border-[color:var(--status-success)] bg-inset px-4 py-3 text-sm font-bold text-primary"
          role="status"
        >
          {successMessage}
        </p>
      ) : null}

      <section aria-labelledby="profile-edit-basic-heading" className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-lg font-bold text-primary" id="profile-edit-basic-heading">
            기본 프로필
          </h2>
          <span className="rounded-[var(--radius-pill)] bg-accent-soft px-3 py-1 text-xs font-bold text-accent">
            모두 필수
          </span>
        </div>
        <div className="grid gap-4">
          <AuthTextField
            error={fieldErrors.displayName}
            helperText="다른 이용자에게 공개되는 이름이에요."
            id="profile-edit-display-name"
            inputRef={refs.displayName}
            label="활동 이름 (필수)"
            maxLength={30}
            name="displayName"
            onChange={(event) => updateText("displayName", event.target.value)}
            onKeyDown={submitProfileEditOnEnter}
            required
            value={values.displayName}
          />
          <AuthTextField
            autoComplete="name"
            error={fieldErrors.realName}
            helperText="계정 확인을 위해 사용하는 실명이에요."
            id="profile-edit-real-name"
            inputRef={refs.realName}
            label="실명 (필수)"
            maxLength={50}
            name="realName"
            onChange={(event) => updateText("realName", event.target.value)}
            onKeyDown={submitProfileEditOnEnter}
            required
            value={values.realName}
          />
          <AuthTextField
            autoComplete="tel"
            error={fieldErrors.phone}
            helperText="예약 등 서비스 안내에 사용해요. 예: 010-1234-5678"
            id="profile-edit-phone"
            inputMode="tel"
            inputRef={refs.phone}
            label="휴대폰 번호 (필수)"
            name="phone"
            onChange={(event) => updateText("phone", event.target.value)}
            onKeyDown={submitProfileEditOnEnter}
            required
            value={values.phone}
          />
        </div>
      </section>

      <section aria-labelledby="profile-edit-region-heading" className="grid gap-3">
        <div
          aria-describedby={fieldErrors.defaultRegion ? "profile-edit-region-error" : undefined}
          className="grid gap-1"
          id="profile-edit-region-focus"
        >
          <h2 className="m-0 text-lg font-bold text-primary" id="profile-edit-region-heading">
            기본 활동 지역 (필수)
          </h2>
          <p className="m-0 text-sm text-secondary">
            가까운 레슨을 찾는 데 사용할 공식 지역을 선택해요.
          </p>
        </div>
        {fieldErrors.defaultRegion ? (
          <p
            className="m-0 text-sm text-[color:var(--status-error)]"
            id="profile-edit-region-error"
          >
            {fieldErrors.defaultRegion}
          </p>
        ) : null}
        <ProfileRegionPicker
          describedBy={fieldErrors.defaultRegion ? "profile-edit-region-error" : undefined}
          disabled={submitting}
          inputRef={refs.defaultRegion}
          invalid={Boolean(fieldErrors.defaultRegion)}
          onChange={updateRegion}
          value={values.defaultRegion}
        />
      </section>

      <fieldset className="grid gap-3 border-t border-line pt-5">
        <legend className="pr-3 text-base font-bold text-primary">선택 동의</legend>
        <p className="m-0 text-sm text-secondary">동의하지 않아도 프로필을 저장할 수 있어요.</p>
        <div className="grid gap-3 rounded-[var(--radius-md)] bg-inset p-4 text-sm text-secondary">
          <ProfileEditConsent
            checked={values.locationAgreed}
            disabled={submitting}
            name="locationAgreed"
            onChange={(event) => updateConsent("locationAgreed", event.target.checked)}
          >
            내 주변 레슨 안내를 위한 위치 이용에 동의해요.
          </ProfileEditConsent>
          <ProfileEditConsent
            checked={values.marketingAgreed}
            disabled={submitting}
            name="marketingAgreed"
            onChange={(event) => updateConsent("marketingAgreed", event.target.checked)}
          >
            혜택과 새로운 레슨 소식 수신에 동의해요.
          </ProfileEditConsent>
        </div>
      </fieldset>

      <Button className="w-full" disabled={!canSubmit} type="submit">
        {submitting ? "저장 중" : "변경사항 저장"}
        <Save aria-hidden="true" className="size-4" strokeWidth={1.8} />
      </Button>
    </form>
  )
}
