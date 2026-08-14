"use client"

import { type RefObject, useEffect, useState } from "react"
import { z } from "zod"
import {
  AUTH_REDIRECT_PATHS,
  type AuthRedirectPath,
  rawNextQueryValue,
  resolveSafeNextPath,
} from "@/lib/auth/redirect"

export { AUTH_REDIRECT_PATHS }

export const GENERIC_AUTH_ERROR = "이메일 또는 비밀번호를 확인해요."
export const GENERIC_SIGNUP_ERROR = "가입을 완료할 수 없어요. 입력 정보를 확인해요."
export const RESET_SUCCESS_MESSAGE =
  "입력한 이메일로 비밀번호 재설정 안내를 보냈어요. 메일함에서 링크를 확인해요."
export const RECOVERY_REQUIRED_MESSAGE = "비밀번호 재설정 링크를 다시 요청해요."

export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  return hydrated
}

export type ProfileDestination = Readonly<
  | { href: AuthRedirectPath; kind: "navigate" }
  | { href: "/auth/login?error=account-deleted"; kind: "account-deleted" }
  | { href: "/auth/login?error=account-suspended"; kind: "account-suspended" }
  | { kind: "error"; message: string }
>

const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
  }),
})

export function readSafeNextFromSearch(
  search: string,
  fallback: AuthRedirectPath = "/lessons",
): AuthRedirectPath {
  return resolveSafeNextPath(rawNextQueryValue(readRawNextQueryValue(search)), fallback)
}

export function readSafeNextFromLocation(
  fallback: AuthRedirectPath = "/lessons",
): AuthRedirectPath {
  if (typeof window === "undefined") return fallback
  return readSafeNextFromSearch(window.location.search, fallback)
}

export async function resolveProfileDestination(
  response: Response,
  nextPath: AuthRedirectPath,
): Promise<ProfileDestination> {
  if (response.status === 200) return { href: nextPath, kind: "navigate" }

  const code = await readApiErrorCode(response)

  switch (code) {
    case "ACCOUNT_DELETED":
      return { href: "/auth/login?error=account-deleted", kind: "account-deleted" }
    case "ACCOUNT_SUSPENDED":
      return { href: "/auth/login?error=account-suspended", kind: "account-suspended" }
    case "PROFILE_REQUIRED":
      return { href: "/onboarding/profile", kind: "navigate" }
    default:
      return { kind: "error", message: GENERIC_AUTH_ERROR }
  }
}

export function focusFirstInvalidField(
  fields: readonly Readonly<{ name: string; ref: RefObject<HTMLInputElement | null> }>[],
  errors: Readonly<Record<string, string>>,
): void {
  for (const field of fields) {
    if (typeof errors[field.name] === "string") {
      field.ref.current?.focus()
      return
    }
  }
}

async function readApiErrorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json()
    const parsed = apiErrorSchema.safeParse(body)
    return parsed.success ? parsed.data.error.code : null
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) return null
    throw error
  }
}

function readRawNextQueryValue(search: string): string | null {
  const query = search.startsWith("?") ? search.slice(1) : search
  if (!query) return null

  for (const part of query.split("&")) {
    const separatorIndex = part.indexOf("=")
    const rawKey = separatorIndex === -1 ? part : part.slice(0, separatorIndex)
    if (rawKey === "next") return separatorIndex === -1 ? "" : part.slice(separatorIndex + 1)
  }

  return null
}
