export type AuthUser = Readonly<{
  id: string
}>

export type UserRole = "admin" | "coach" | "learner"
export type UserStatus = "active" | "coach_approved" | "deleted" | "pending_coach" | "suspended"
export type CoachStatus = "approved" | "draft" | "rejected" | "submitted" | "suspended"

export type ProfileRow = Readonly<{
  avatar_path: string | null
  default_region: string | null
  deleted_at: string | null
  display_name: string
  id: string
  location_agreed_at: string | null
  marketing_agreed_at: string | null
  phone: string | null
  real_name: string | null
  role: UserRole
  status: UserStatus
}>

export type CoachProfileRow = Readonly<{
  headline: string | null
  id: string
  service_region: string
  status: CoachStatus
}>

export type ProfileData = Readonly<{
  avatarPath: string | null
  coachProfile: ProfileCoachData | null
  defaultRegion: string | null
  deletedAt: string | null
  displayName: string
  id: string
  locationAgreedAt: string | null
  marketingAgreedAt: string | null
  phone: string | null
  realName: string | null
  role: UserRole
  status: UserStatus
}>

export type ProfileCoachData = Readonly<{
  headline: string | null
  id: string
  serviceRegion: string
  status: CoachStatus
}>

export type WorkflowError = Readonly<{
  code: string
  message: string
  statusCode: number
}>

export type WorkflowFailure = Readonly<{
  error: WorkflowError
  status: "failure"
}>

export type WorkflowResult<T> = Readonly<
  | {
      response: T
      status: "success"
      statusCode: number
    }
  | WorkflowFailure
>

export type ProfileResponse = Readonly<{
  data: ProfileData
}>

export type ProfileReadResult = Readonly<{
  errorCode: string | null
  profile: ProfileRow | null
}>

export type CoachProfileReadResult = Readonly<{
  coachProfile: CoachProfileRow | null
  errorCode: string | null
}>

export type ProfileInsertInput = Readonly<{
  defaultRegion: string
  displayName: string
  id: string
  locationAgreedAt: string | null
  marketingAgreedAt: string | null
  phone: string
  realName: string
  role: "learner"
  status: "active"
}>

export type ProfileUpdateInput = Readonly<{
  avatar_path?: string | null
  default_region?: string | null
  display_name?: string
  location_agreed_at?: string | null
  marketing_agreed_at?: string | null
  phone?: string | null
  real_name?: string | null
}>

export type ProfileMutationResult = Readonly<{
  errorCode: string | null
  profile: ProfileRow | null
}>

export type ProfileWorkflowDependencies = Readonly<{
  createProfile: (input: ProfileInsertInput) => Promise<ProfileMutationResult>
  getCoachProfile: (userId: string) => Promise<CoachProfileReadResult>
  getCurrentProfile: (userId: string) => Promise<ProfileReadResult>
  getVerifiedAuthUser: () => Promise<AuthUser | null>
  now?: () => string
  updateProfile: (userId: string, patch: ProfileUpdateInput) => Promise<ProfileMutationResult>
}>
