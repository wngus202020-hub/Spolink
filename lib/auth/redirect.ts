export const AUTH_REDIRECT_PATHS = [
  "/",
  "/lessons",
  "/mypage",
  "/mypage/favorites",
  "/mypage/reservations",
  "/onboarding/profile",
  "/auth/update-password",
] as const

export type AuthRedirectPath =
  | (typeof AUTH_REDIRECT_PATHS)[number]
  | `/lessons/${string}/booking`
  | `/lessons/${string}/booking?scheduleId=${string}`
  | `/mypage/reservations/${string}`
  | `/reservations/${string}/payment`

export type AuthRedirectInput = Readonly<
  | {
      source: "raw-query"
      value: string | null | undefined
    }
  | {
      source: "decoded-query"
      value: string | null | undefined
    }
>

const allowedRedirectPaths = new Set<string>(AUTH_REDIRECT_PATHS)

export function resolveSafeNextPath(
  nextInput: AuthRedirectInput,
  fixedDestination: AuthRedirectPath,
): AuthRedirectPath {
  if (nextInput.source === "decoded-query") return fixedDestination
  if (typeof nextInput.value !== "string") return fixedDestination
  if (isSafeAllowedPath(nextInput.value)) return nextInput.value
  return fixedDestination
}

export function rawNextQueryValue(value: string | null | undefined): AuthRedirectInput {
  return { source: "raw-query", value }
}

export function decodedNextQueryValue(value: string | null | undefined): AuthRedirectInput {
  return { source: "decoded-query", value }
}

export function resolveSafeNextPathFromUrl(
  url: string | URL,
  fixedDestination: AuthRedirectPath,
): AuthRedirectPath {
  const parsedUrl = typeof url === "string" ? new URL(url) : url
  const rawNextValue = readRawNextQueryValue(parsedUrl.search)

  return resolveSafeNextPath(rawNextQueryValue(rawNextValue), fixedDestination)
}

function isSafeAllowedPath(value: string): value is AuthRedirectPath {
  if (value.includes("%")) return false
  if (value.includes("\\")) return false
  if (hasControlCharacter(value)) return false
  if (value.startsWith("//")) return false
  if (value.includes("#")) return false
  if (allowedRedirectPaths.has(value)) return !value.includes("?")
  if (isSafeBookingPath(value)) return true
  if (isSafeMyPageReservationPath(value)) return true
  if (isSafePaymentPath(value)) return true

  return false
}

function isSafeBookingPath(value: string): value is `/lessons/${string}/booking` {
  const match = /^\/lessons\/([a-z0-9-]+)\/booking(?:\?scheduleId=([a-z0-9-]+))?$/u.exec(value)
  if (!match) return false
  const [, lessonId, scheduleId] = match

  return Boolean(lessonId && !lessonId.includes("..") && !scheduleId?.includes(".."))
}

function isSafeMyPageReservationPath(value: string): value is `/mypage/reservations/${string}` {
  return /^\/mypage\/reservations\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  )
}

function isSafePaymentPath(value: string): value is `/reservations/${string}/payment` {
  return /^\/reservations\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/payment$/iu.test(
    value,
  )
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 0x1f || code === 0x7f) return true
  }

  return false
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
