import { z } from "zod"

import type { CoachStatus, UserRole, UserStatus } from "../profile/types"

const uuidSchema = z.string().uuid()
const boundedText = (maximumLength: number) => z.string().trim().min(1).max(maximumLength)

const coachStatusSchema = z.enum(["draft", "submitted", "approved", "rejected", "suspended"])
const reviewDecisionSchema = z.enum(["approve", "reject"])
const adminCoachListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: coachStatusSchema.default("submitted"),
})

export const coachApplicationRequestSchema = z.strictObject({
  bankAccountLast4: z.string().regex(/^\d{4}$/),
  bankName: boundedText(100),
  bio: boundedText(5000),
  careerYears: z.number().int().min(0).max(100),
  headline: boundedText(120),
  payoutHolderName: boundedText(100),
  primarySportId: uuidSchema,
  serviceRegion: boundedText(100),
})

export const certificateMetadataRequestSchema = z.strictObject({
  certificateName: boundedText(120),
  certificateNumber: boundedText(100).nullable().optional(),
  filePath: z.string().trim().min(1).max(1024).refine(isPrivateObjectName),
  issuer: boundedText(120).nullable().optional(),
})

const approveCoachReviewRequestSchema = z.strictObject({})
const rejectCoachReviewRequestSchema = z.strictObject({
  rejectionReason: boundedText(1000),
})

export type CoachApplicationRequest = z.infer<typeof coachApplicationRequestSchema>
export type CertificateMetadataRequest = z.infer<typeof certificateMetadataRequestSchema>
export type CoachReviewDecision = z.infer<typeof reviewDecisionSchema>
export type ApproveCoachReviewRequest = z.infer<typeof approveCoachReviewRequestSchema>
export type RejectCoachReviewRequest = z.infer<typeof rejectCoachReviewRequestSchema>
export type AdminCoachReviewRequest = ApproveCoachReviewRequest | RejectCoachReviewRequest
export type AdminCoachListQuery = z.infer<typeof adminCoachListQuerySchema>

export type CoachCertificationProfileRow = Readonly<{
  bank_account_last4: string | null
  bank_name: string | null
  bio: string | null
  career_years: number
  created_at: string
  headline: string | null
  id: string
  intro_video_url: string | null
  payout_holder_name: string | null
  primary_sport_id: string | null
  rejection_reason: string | null
  reviewed_at: string | null
  reviewed_by: string | null
  service_region: string
  status: CoachStatus
  submitted_at: string | null
  updated_at: string
  user_id: string
}>

export type CoachCertificateRow = Readonly<{
  certificate_name: string
  certificate_number: string | null
  coach_profile_id: string
  created_at: string
  file_path: string
  id: string
  issuer: string | null
  rejected_reason: string | null
  updated_at: string
  verified_at: string | null
}>

export type CoachCertificateData = Readonly<{
  certificateName: string
  certificateNumber: string | null
  id: string
  issuer: string | null
  verifiedAt: string | null
}>

export type CoachCertificationResponse = Readonly<{
  data: Readonly<{
    certificates: readonly CoachCertificateData[]
    headline: string | null
    id: string
    serviceRegion: string
    status: CoachStatus
  }>
}>

export type CoachCertificationStatusTuple = Readonly<{
  coachStatus: CoachStatus
  profileRole: Extract<UserRole, "learner">
  profileStatus: UserStatus
}>

export const COACH_CERTIFICATION_STATUS_TUPLES = {
  approved: { coachStatus: "approved", profileRole: "learner", profileStatus: "coach_approved" },
  draft: { coachStatus: "draft", profileRole: "learner", profileStatus: "active" },
  rejected: { coachStatus: "rejected", profileRole: "learner", profileStatus: "active" },
  submitted: { coachStatus: "submitted", profileRole: "learner", profileStatus: "pending_coach" },
  suspended: { coachStatus: "suspended", profileRole: "learner", profileStatus: "suspended" },
} as const satisfies Readonly<Record<CoachStatus, CoachCertificationStatusTuple>>

export type CoachSubmissionTransition =
  | Readonly<{
      clearReviewFields: boolean
      kind: "transition"
      next: CoachCertificationStatusTuple
    }>
  | Readonly<{ kind: "conflict" }>

export type CoachReviewTransition =
  | Readonly<{ kind: "transition"; next: CoachCertificationStatusTuple }>
  | Readonly<{ kind: "idempotent" }>
  | Readonly<{ kind: "conflict" }>

export function parseCoachApplicationRequest(value: unknown): CoachApplicationRequest | null {
  const parsed = coachApplicationRequestSchema.safeParse(value)

  return parsed.success ? parsed.data : null
}

export function parseCoachCertificationStatus(value: unknown): CoachStatus | null {
  const parsed = coachStatusSchema.safeParse(value)

  return parsed.success ? parsed.data : null
}

export function parseCertificateMetadataRequest(value: unknown): CertificateMetadataRequest | null {
  const parsed = certificateMetadataRequestSchema.safeParse(value)

  return parsed.success ? parsed.data : null
}

export function parseOwnedCertificateMetadataRequest(
  value: unknown,
  verifiedUserId: string,
): CertificateMetadataRequest | null {
  if (!uuidSchema.safeParse(verifiedUserId).success) return null

  const request = parseCertificateMetadataRequest(value)
  if (!request?.filePath.startsWith(`${verifiedUserId}/`)) return null

  return request
}

export function parseAdminCoachReviewRequest(
  decision: CoachReviewDecision,
  value: unknown,
): AdminCoachReviewRequest | null {
  const schema =
    decision === "approve" ? approveCoachReviewRequestSchema : rejectCoachReviewRequestSchema
  const parsed = schema.safeParse(value)

  return parsed.success ? parsed.data : null
}

export function parseAdminCoachListQuery(value: URLSearchParams): AdminCoachListQuery | null {
  const parsed = adminCoachListQuerySchema.safeParse({
    page: value.get("page") ?? undefined,
    pageSize: value.get("pageSize") ?? undefined,
    status: value.get("status") ?? undefined,
  })

  return parsed.success ? parsed.data : null
}

export function isCoachCertificationEditable(status: CoachStatus): boolean {
  switch (status) {
    case "draft":
    case "rejected":
      return true
    case "submitted":
    case "approved":
    case "suspended":
      return false
    default:
      return assertNever(status)
  }
}

export function readCoachSubmissionTransition(status: CoachStatus): CoachSubmissionTransition {
  switch (status) {
    case "draft":
      return {
        clearReviewFields: false,
        kind: "transition",
        next: COACH_CERTIFICATION_STATUS_TUPLES.submitted,
      }
    case "rejected":
      return {
        clearReviewFields: true,
        kind: "transition",
        next: COACH_CERTIFICATION_STATUS_TUPLES.submitted,
      }
    case "submitted":
    case "approved":
    case "suspended":
      return { kind: "conflict" }
    default:
      return assertNever(status)
  }
}

export function readCoachReviewTransition(
  status: CoachStatus,
  decision: CoachReviewDecision,
): CoachReviewTransition {
  switch (status) {
    case "submitted":
      return {
        kind: "transition",
        next:
          decision === "approve"
            ? COACH_CERTIFICATION_STATUS_TUPLES.approved
            : COACH_CERTIFICATION_STATUS_TUPLES.rejected,
      }
    case "approved":
      return decision === "approve" ? { kind: "idempotent" } : { kind: "conflict" }
    case "rejected":
      return decision === "reject" ? { kind: "idempotent" } : { kind: "conflict" }
    case "draft":
    case "suspended":
      return { kind: "conflict" }
    default:
      return assertNever(status)
  }
}

export function mapCoachCertificationResponse(
  profile: CoachCertificationProfileRow,
  certificates: readonly CoachCertificateRow[],
): CoachCertificationResponse {
  return {
    data: {
      certificates: certificates.map(mapCoachCertificateData),
      headline: profile.headline,
      id: profile.id,
      serviceRegion: profile.service_region,
      status: profile.status,
    },
  }
}

function isPrivateObjectName(value: string): boolean {
  if (value.startsWith("/") || value.includes("://")) return false

  return value
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
}

function mapCoachCertificateData(certificate: CoachCertificateRow): CoachCertificateData {
  return {
    certificateName: certificate.certificate_name,
    certificateNumber: certificate.certificate_number,
    id: certificate.id,
    issuer: certificate.issuer,
    verifiedAt: certificate.verified_at,
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected coach certification status: ${value}`)
}
