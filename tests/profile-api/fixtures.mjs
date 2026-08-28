import { register } from "node:module"

const projectRootUrl = new URL("../../", import.meta.url).href

register(
  `data:text/javascript,${encodeURIComponent(`
    const projectRootUrl = ${JSON.stringify(projectRootUrl)}

    export async function resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@/")) {
        return nextResolve(new URL(specifier.slice(2) + ".ts", projectRootUrl).href, context)
      }

      try {
        return await nextResolve(specifier, context)
      } catch (error) {
        if (error && error.code === "ERR_MODULE_NOT_FOUND" && /^(?:\\.\\.?\\/)/.test(specifier)) {
          return nextResolve(specifier + ".ts", context)
        }
        throw error
      }
    }
  `)}`,
  import.meta.url,
)

export const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
export const PROFILE_URL = "http://127.0.0.1/api/profiles"
export const PROFILE_ORIGIN = new URL(PROFILE_URL).origin

export function makeCreateRequest() {
  return {
    defaultRegion: "서울특별시 강남구",
    displayName: "홍길동",
    locationAgreed: true,
    marketingAgreed: false,
    phone: "010-1234-5678",
    realName: "홍길동",
  }
}

export function makeProfileRow(overrides = {}) {
  return {
    avatar_path: overrides.avatarPath ?? null,
    default_region: overrides.defaultRegion ?? "서울특별시 강남구",
    deleted_at: overrides.deletedAt ?? null,
    display_name: overrides.displayName ?? "홍길동",
    id: overrides.id ?? TEST_USER_ID,
    location_agreed_at: overrides.locationAgreedAt ?? null,
    marketing_agreed_at: overrides.marketingAgreedAt ?? null,
    phone: overrides.phone ?? "010-1234-5678",
    real_name: overrides.realName ?? "홍길동",
    role: overrides.role ?? "learner",
    status: overrides.status ?? "active",
  }
}

export function jsonRequest(body, options = {}) {
  const headers = new Headers()
  if (options.contentType !== null) {
    headers.set("content-type", options.contentType ?? "application/json")
  }
  if (options.origin !== null) {
    headers.set("origin", options.origin ?? PROFILE_ORIGIN)
  }

  const request = new Request(PROFILE_URL, {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers,
    method: options.method ?? "POST",
  })

  if (options.contentType === null) {
    request.headers.delete("content-type")
  }

  return request
}

export function validationError(message) {
  return errorBody("VALIDATION_ERROR", message)
}

export function errorBody(code, message) {
  return { error: { code, details: [], message } }
}
