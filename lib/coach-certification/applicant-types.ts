import type { AuthUser, ProfileRow, WorkflowResult } from "../profile/types"
import type {
  CoachApplicationRequest,
  CoachCertificateRow,
  CoachCertificationProfileRow,
} from "./contract"

export type ApplicantCertificateData = Readonly<{
  certificateName: string
  certificateNumber: string | null
  id: string
  issuer: string | null
  verifiedAt: string | null
}>

export type ApplicantApplicationData = Readonly<{
  bankAccountLast4: string | null
  bankName: string | null
  bio: string | null
  careerYears: number
  certificates: readonly ApplicantCertificateData[]
  headline: string | null
  id: string
  payoutHolderName: string | null
  primarySportId: string | null
  rejectionReason: string | null
  serviceRegion: string
  status: CoachCertificationProfileRow["status"]
}>

export type ApplicantApplicationResponse = Readonly<{
  data: ApplicantApplicationData | null
}>

export type CertificateRegistrationRequest = Readonly<{
  certificateName: string
  certificateNumber?: string | null
  issuer?: string | null
  objectName: string
}>

export type ApplicantReadResult = Readonly<{
  certificates: readonly CoachCertificateRow[]
  errorCode: string | null
  profile: CoachCertificationProfileRow | null
}>

export type ApplicantMutationResult = Readonly<{
  errorCode: string | null
  profile: CoachCertificationProfileRow | null
}>

export type CertificateMutationResult = Readonly<{
  errorCode: string | null
  row: CoachCertificateRow | null
}>

export type ApplicantWorkflowDependencies = Readonly<{
  createCertificate: (
    userId: string,
    request: CertificateRegistrationRequest,
  ) => Promise<CertificateMutationResult>
  createSignedUpload: (
    userId: string,
    mimeType: string,
    sizeBytes: number,
  ) => Promise<Readonly<{ errorCode: string | null; result: SignedUploadData | null }>>
  deleteCertificate: (
    userId: string,
    certificateId: string,
  ) => Promise<{ errorCode: string | null }>
  getVerifiedAuthUser: () => Promise<AuthUser | null>
  readAccount: (
    userId: string,
  ) => Promise<Readonly<{ errorCode: string | null; row: ProfileRow | null }>>
  readApplication: (userId: string) => Promise<ApplicantReadResult>
  updateApplication: (
    userId: string,
    request: CoachApplicationRequest,
  ) => Promise<ApplicantMutationResult>
}>

export type SignedUploadData = Readonly<{
  expiresIn: 300
  objectName: string
  uploadUrl: string
}>

export type ApplicantWorkflowResult = WorkflowResult<ApplicantApplicationResponse>
