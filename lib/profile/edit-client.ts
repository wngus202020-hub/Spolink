import ky from "ky"
import { z } from "zod"

import {
  mapProfileDataToEditInitialData,
  type ProfileEditInitialData,
  type ProfileEditPatch,
  profileEditPatchSchema,
} from "./edit-contract"

const profileEditResponseDataSchema = z.object({
  defaultRegion: z.string().nullable(),
  displayName: z.string(),
  locationAgreedAt: z.iso.datetime({ offset: true }).nullable(),
  marketingAgreedAt: z.iso.datetime({ offset: true }).nullable(),
  phone: z.string().nullable(),
  realName: z.string().nullable(),
})

const profileSuccessSchema = z.strictObject({ data: profileEditResponseDataSchema })
const profileErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    statusCode: z.number().int(),
  }),
})

export type ProfileEditClientResult = Readonly<
  | { baseline: ProfileEditInitialData; status: "success" }
  | { status: "no_changes" }
  | { category: "login"; destination: "/auth/login?next=/mypage/profile"; status: "failure" }
  | {
      category: "restricted"
      destination:
        | "/auth/restricted?reason=account-deleted"
        | "/auth/restricted?reason=account-suspended"
      status: "failure"
    }
  | { category: "onboarding"; destination: "/onboarding/profile"; status: "failure" }
  | { category: "validation"; retainInput: true; status: "failure" }
  | {
      category: "retry"
      reason: "malformed_response" | "network" | "server"
      status: "failure"
    }
>

type ProfileEditRequestOptions = Readonly<{
  cache: "no-store"
  credentials: "same-origin"
  json: ProfileEditPatch
  method: "patch"
  retry: 0
  throwHttpErrors: false
  timeout: 5_000
}>

export type ProfileEditClientDependencies = Readonly<{
  request: (url: string, options: ProfileEditRequestOptions) => Promise<Response>
}>

const defaultDependencies: ProfileEditClientDependencies = {
  request: async (url, options) => ky(url, options),
}

export function parseProfileEditResponse(
  statusCode: number,
  body: unknown,
): ProfileEditClientResult {
  if (statusCode === 200) {
    const parsedSuccess = profileSuccessSchema.safeParse(body)
    if (!parsedSuccess.success) return malformedResponse()
    return {
      baseline: mapProfileDataToEditInitialData(parsedSuccess.data.data),
      status: "success",
    }
  }

  const parsedError = profileErrorSchema.safeParse(body)
  if (statusCode === 500 || statusCode === 503) {
    return { category: "retry", reason: "server", status: "failure" }
  }
  if (!parsedError.success || parsedError.data.error.statusCode !== statusCode) {
    return malformedResponse()
  }

  const code = parsedError.data.error.code
  if (statusCode === 401 && code === "UNAUTHORIZED") {
    return {
      category: "login",
      destination: "/auth/login?next=/mypage/profile",
      status: "failure",
    }
  }
  if (statusCode === 403 && code === "ACCOUNT_SUSPENDED") {
    return {
      category: "restricted",
      destination: "/auth/restricted?reason=account-suspended",
      status: "failure",
    }
  }
  if (statusCode === 403 && code === "ACCOUNT_DELETED") {
    return {
      category: "restricted",
      destination: "/auth/restricted?reason=account-deleted",
      status: "failure",
    }
  }
  if (statusCode === 409 && code === "PROFILE_REQUIRED") {
    return { category: "onboarding", destination: "/onboarding/profile", status: "failure" }
  }
  if (statusCode === 422 && code === "VALIDATION_ERROR") {
    return { category: "validation", retainInput: true, status: "failure" }
  }
  return malformedResponse()
}

export async function patchCurrentProfile(
  patch: ProfileEditPatch | null,
  dependencies: ProfileEditClientDependencies = defaultDependencies,
): Promise<ProfileEditClientResult> {
  if (patch === null) return { status: "no_changes" }

  const parsedPatch = profileEditPatchSchema.safeParse(patch)
  if (!parsedPatch.success) {
    return { category: "validation", retainInput: true, status: "failure" }
  }

  let response: Response
  try {
    response = await dependencies.request("/api/profiles/me", {
      cache: "no-store",
      credentials: "same-origin",
      json: parsedPatch.data,
      method: "patch",
      retry: 0,
      throwHttpErrors: false,
      timeout: 5_000,
    })
  } catch (error) {
    if (error instanceof Error) {
      return { category: "retry", reason: "network", status: "failure" }
    }
    throw error
  }

  return parseProfileEditResponse(response.status, await readJson(response))
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

function malformedResponse(): ProfileEditClientResult {
  return { category: "retry", reason: "malformed_response", status: "failure" }
}
