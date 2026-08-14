import ky, { HTTPError } from "ky"
import { z } from "zod"

import type { ApplicantApplicationData } from "./applicant-types"

const certificateSchema = z.strictObject({
  certificateName: z.string(),
  certificateNumber: z.string().nullable(),
  id: z.uuid(),
  issuer: z.string().nullable(),
  verifiedAt: z.string().nullable(),
})
const applicationSchema = z.strictObject({
  bankAccountLast4: z.string().nullable(),
  bankName: z.string().nullable(),
  bio: z.string().nullable(),
  careerYears: z.number().int(),
  certificates: z.array(certificateSchema),
  headline: z.string().nullable(),
  id: z.uuid(),
  payoutHolderName: z.string().nullable(),
  primarySportId: z.string().uuid().nullable(),
  rejectionReason: z.string().nullable(),
  serviceRegion: z.string(),
  status: z.enum(["draft", "submitted", "approved", "rejected", "suspended"]),
})
const responseSchema = z.strictObject({ data: applicationSchema.nullable() })
const uploadResponseSchema = z.strictObject({
  data: z.strictObject({
    expiresIn: z.literal(300),
    objectName: z.string(),
    uploadUrl: z.string(),
  }),
})

export type ApplicantClientResult<T> = Readonly<
  { data: T; status: "success" } | { code: string; message: string; status: "failure" }
>

export async function readCoachApplication(): Promise<
  ApplicantClientResult<ApplicantApplicationData | null>
> {
  return requestApplication("/api/coach-profile/me", { method: "get" })
}

export async function saveCoachApplication(
  data: Readonly<Record<string, string | number>>,
): Promise<ApplicantClientResult<ApplicantApplicationData | null>> {
  return requestApplication("/api/coach-profile/me", { json: data, method: "put" })
}

export async function submitCoachApplication(): Promise<ApplicantClientResult<null>> {
  const result = await requestJson("/api/coach-profile/me/submit", {
    json: {},
    method: "post",
  })
  return result.status === "failure" ? result : { data: null, status: "success" }
}

export async function createCertificateUpload(file: File) {
  const result = await requestJson("/api/coach-profile/me/certificate-upload-url", {
    json: { mimeType: file.type, sizeBytes: file.size },
    method: "post",
  })
  if (result.status === "failure") return result
  const parsed = uploadResponseSchema.safeParse(result.value)
  return parsed.success
    ? { data: parsed.data.data, status: "success" as const }
    : failure("INVALID_RESPONSE", "업로드 응답을 확인하지 못했어요.")
}

export async function uploadCertificateFile(uploadUrl: string, file: File) {
  try {
    await ky.put(uploadUrl, {
      body: file,
      credentials: "omit",
      headers: { "Content-Type": file.type },
      retry: 0,
      timeout: 30_000,
    })
    return { status: "success" as const }
  } catch (error) {
    if (error instanceof HTTPError || error instanceof TypeError) {
      return failure("UPLOAD_FAILED", "파일 업로드에 실패했어요. 다시 시도해요.")
    }
    throw error
  }
}

export async function registerCoachCertificate(data: Readonly<Record<string, string | null>>) {
  return requestApplication("/api/coach-profile/me/certificates", { json: data, method: "post" })
}

export async function deleteCoachCertificate(certificateId: string) {
  const result = await requestJson(`/api/coach-profile/me/certificates/${certificateId}`, {
    json: {},
    method: "delete",
  })
  if (result.status === "failure") return result
  return { data: true, status: "success" as const }
}

async function requestApplication(url: string, options: Parameters<typeof ky>[1]) {
  const result = await requestJson(url, options)
  if (result.status === "failure") return result
  const parsed = responseSchema.safeParse(result.value)
  return parsed.success
    ? { data: parsed.data.data, status: "success" as const }
    : failure("INVALID_RESPONSE", "신청서 응답을 확인하지 못했어요.")
}

async function requestJson(url: string, options: Parameters<typeof ky>[1]) {
  try {
    const response = await ky(url, {
      cache: "no-store",
      credentials: "same-origin",
      retry: 0,
      timeout: 15_000,
      throwHttpErrors: false,
      ...options,
    })
    if (!response.ok) {
      return failure(readErrorCode(await safeJson(response)), errorMessage(response.status))
    }
    const value: unknown = await response.json()
    return { status: "success" as const, value }
  } catch (error) {
    if (error instanceof TypeError) return failure("NETWORK_ERROR", "연결이 원활하지 않아요.")
    throw error
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

function readErrorCode(value: unknown) {
  if (typeof value !== "object" || value === null || !("error" in value)) return "UNKNOWN_ERROR"
  const error = value.error
  if (typeof error !== "object" || error === null || !("code" in error)) return "UNKNOWN_ERROR"
  return typeof error.code === "string" ? error.code : "UNKNOWN_ERROR"
}

function errorMessage(status: number) {
  if (status === 401) return "로그인이 만료되었어요. 다시 로그인해요."
  if (status === 403) return "이 작업을 진행할 권한이 없어요. 이용 상태를 확인해요."
  if (status === 409) return "심사 상태가 바뀌었어요. 신청 상태를 확인해요."
  if (status === 422) return "필수 신청 정보와 자격증을 다시 확인해요."
  return "요청을 완료하지 못했어요. 잠시 후 다시 시도해요."
}

function failure(code: string, message: string) {
  return { code, message, status: "failure" as const }
}
