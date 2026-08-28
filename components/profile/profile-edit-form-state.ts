import type { KeyboardEvent, RefObject } from "react"
import type { ProfileEditClientResult } from "@/lib/profile/edit-client"
import type {
  buildProfileEditPatch,
  ProfileEditField,
  ProfileEditInitialData,
} from "@/lib/profile/edit-contract"

export type ProfileEditDraftValues = Readonly<{
  defaultRegion: string | null
  displayName: string
  locationAgreed: boolean
  marketingAgreed: boolean
  phone: string
  realName: string
}>

export type ProfileEditFieldErrors = Partial<Record<ProfileEditField, string>>

export type ProfileEditRefs = Readonly<{
  defaultRegion: RefObject<HTMLInputElement | null>
  displayName: RefObject<HTMLInputElement | null>
  phone: RefObject<HTMLInputElement | null>
  realName: RefObject<HTMLInputElement | null>
}>

export type ProfileEditSubmit = (
  patch: NonNullable<ReturnType<typeof buildProfileEditPatch>>,
) => Promise<ProfileEditClientResult>

const fieldErrorMessages: Record<ProfileEditField, string> = {
  defaultRegion: "목록에서 기본 활동 지역을 선택해요.",
  displayName: "활동 이름은 2자 이상 입력해요.",
  locationAgreed: "위치 정보 동의 값을 다시 확인해요.",
  marketingAgreed: "마케팅 수신 동의 값을 다시 확인해요.",
  phone: "올바른 휴대폰 번호를 입력해요.",
  realName: "실명은 2자 이상 입력해요.",
}

export function draftFromInitial(initialProfile: ProfileEditInitialData): ProfileEditDraftValues {
  return {
    defaultRegion: initialProfile.defaultRegion,
    displayName: initialProfile.displayName,
    locationAgreed: initialProfile.locationAgreed,
    marketingAgreed: initialProfile.marketingAgreed,
    phone: initialProfile.phone ?? "",
    realName: initialProfile.realName ?? "",
  }
}

export function draftHasPotentialChanges(
  baseline: ProfileEditInitialData,
  values: ProfileEditDraftValues,
): boolean {
  return (
    normalizeDraftValue(baseline.defaultRegion) !== normalizeDraftValue(values.defaultRegion) ||
    baseline.displayName.trim() !== values.displayName.trim() ||
    baseline.locationAgreed !== values.locationAgreed ||
    baseline.marketingAgreed !== values.marketingAgreed ||
    normalizeDraftValue(baseline.phone) !== normalizeDraftValue(values.phone) ||
    normalizeDraftValue(baseline.realName) !== normalizeDraftValue(values.realName)
  )
}

export function buildFieldErrors(fields: readonly ProfileEditField[]): ProfileEditFieldErrors {
  const errors: ProfileEditFieldErrors = {}
  for (const field of fields) errors[field] = fieldErrorMessages[field]
  return errors
}

export function focusFirstFieldError(refs: ProfileEditRefs, errors: ProfileEditFieldErrors): void {
  if (errors.displayName) {
    refs.displayName.current?.focus()
    return
  }
  if (errors.realName) {
    refs.realName.current?.focus()
    return
  }
  if (errors.phone) {
    refs.phone.current?.focus()
    return
  }
  if (errors.defaultRegion) refs.defaultRegion.current?.focus()
}

export function submitProfileEditOnEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (
    event.key !== "Enter" ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.nativeEvent.isComposing
  ) {
    return
  }
  event.preventDefault()
  event.currentTarget.form?.requestSubmit()
}

export function profileEditFailureMessage(
  result: Exclude<ProfileEditClientResult, { status: "success" }>,
): string {
  if (result.status === "no_changes") return ""
  if (result.category === "validation") return "입력 내용을 다시 확인해요."
  if (result.category !== "retry") return "프로필을 저장하지 못했어요. 잠시 후 다시 시도해요."
  if (result.reason === "malformed_response") {
    return "프로필 저장 응답을 확인하지 못했어요. 다시 시도해요."
  }
  if (result.reason === "server") {
    return "서버에서 프로필을 저장하지 못했어요. 잠시 후 다시 시도해요."
  }
  return "연결이 원활하지 않아요. 잠시 후 다시 시도해요."
}

function normalizeDraftValue(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}
