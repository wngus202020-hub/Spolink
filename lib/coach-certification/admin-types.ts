import type { AdminCoachListQuery } from "./contract"

export type VerifiedAdmin = Readonly<{ id: string }>
export type AdminAccess =
  | Readonly<{ kind: "admin"; user: VerifiedAdmin }>
  | Readonly<{ kind: "forbidden" }>
  | Readonly<{ kind: "unauthenticated" }>

export type AdminCoachListItem = Readonly<{
  certificateCount: number
  displayName: string
  headline: string | null
  id: string
  reviewedAt: string | null
  serviceRegion: string
  sportName: string | null
  status: AdminCoachListQuery["status"]
  submittedAt: string | null
}>

export type AdminCoachListData = Readonly<{
  items: readonly AdminCoachListItem[]
  page: number
  pageSize: number
  status: AdminCoachListQuery["status"]
  total: number
}>

export type AdminCoachCertificate = Readonly<{
  certificateName: string
  certificateNumber: string | null
  id: string
  issuer: string | null
  verifiedAt: string | null
}>

export type AdminCoachDetailData = Readonly<{
  bankAccountLast4: string | null
  bankName: string | null
  bio: string | null
  careerYears: number
  certificates: readonly AdminCoachCertificate[]
  displayName: string
  headline: string | null
  id: string
  payoutHolderName: string | null
  rejectionReason: string | null
  reviewedAt: string | null
  serviceRegion: string
  sportName: string | null
  status: AdminCoachListQuery["status"]
  submittedAt: string | null
}>

export type AdminCoachReviewData = Readonly<{
  coachProfileId: string
  coachStatus: "approved" | "rejected"
  idempotent: boolean
  profileStatus: "active" | "coach_approved"
  reviewedAt: string
}>

export type AdminRepositoryResult<T> = Readonly<{
  data: T | null
  errorCode: string | null
}>

export type AdminReviewDependencies = Readonly<{
  createCertificateRead: (
    adminId: string,
    coachProfileId: string,
    certificateId: string,
  ) => Promise<AdminRepositoryResult<Readonly<{ expiresIn: 300; readUrl: string }>>>
  getVerifiedAdmin: () => Promise<AdminAccess>
  listApplications: (
    query: AdminCoachListQuery,
  ) => Promise<AdminRepositoryResult<AdminCoachListData>>
  readApplication: (coachProfileId: string) => Promise<AdminRepositoryResult<AdminCoachDetailData>>
  reviewApplication: (
    coachProfileId: string,
    decision: "approve" | "reject",
    rejectionReason: string | null,
  ) => Promise<AdminRepositoryResult<AdminCoachReviewData>>
}>
