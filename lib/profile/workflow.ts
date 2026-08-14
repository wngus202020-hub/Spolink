import type {
  CoachProfileRow,
  ProfileData,
  ProfileReadResult,
  ProfileResponse,
  ProfileRow,
  ProfileUpdateInput,
  ProfileWorkflowDependencies,
  WorkflowFailure,
  WorkflowResult,
} from "./types"
import type { CreateProfileRequest, PatchProfileRequest } from "./validation"

export async function runGetCurrentProfileWorkflow(
  deps: ProfileWorkflowDependencies,
): Promise<WorkflowResult<ProfileResponse>> {
  const user = await deps.getVerifiedAuthUser()

  if (!user) {
    return failure("UNAUTHORIZED", "Authentication required.", 401)
  }

  const profileResult = await deps.getCurrentProfile(user.id)
  const profileState = readExistingProfileState(profileResult)

  if (profileState.status === "failure") {
    return profileState
  }

  return readProfileResponse(profileState.profile, deps, 200)
}

export async function runCreateProfileWorkflow(
  request: CreateProfileRequest,
  deps: ProfileWorkflowDependencies,
): Promise<WorkflowResult<ProfileResponse>> {
  const user = await deps.getVerifiedAuthUser()

  if (!user) {
    return failure("UNAUTHORIZED", "Authentication required.", 401)
  }

  const profileResult = await deps.getCurrentProfile(user.id)

  if (profileResult.errorCode) {
    return internalError()
  }

  if (profileResult.profile) {
    const accountError = getAccountStateError(profileResult.profile)

    return accountError ?? failure("PROFILE_ALREADY_EXISTS", "Profile already exists.", 409)
  }

  const created = await deps.createProfile({
    defaultRegion: request.defaultRegion,
    displayName: request.displayName,
    id: user.id,
    locationAgreedAt: request.locationAgreed ? readNow(deps) : null,
    marketingAgreedAt: request.marketingAgreed ? readNow(deps) : null,
    phone: request.phone,
    realName: request.realName,
    role: "learner",
    status: "active",
  })

  if (created.errorCode === "23505") {
    return failure("PROFILE_ALREADY_EXISTS", "Profile already exists.", 409)
  }

  if (created.errorCode || !created.profile) {
    return internalError()
  }

  return readProfileResponse(created.profile, deps, 201)
}

export async function runPatchProfileWorkflow(
  request: PatchProfileRequest,
  deps: ProfileWorkflowDependencies,
): Promise<WorkflowResult<ProfileResponse>> {
  const user = await deps.getVerifiedAuthUser()

  if (!user) {
    return failure("UNAUTHORIZED", "Authentication required.", 401)
  }

  const avatarPath = request.avatarPath

  if (typeof avatarPath === "string" && !avatarPath.startsWith(`profiles/${user.id}/`)) {
    return failure("VALIDATION_ERROR", "Invalid profile request.", 422)
  }

  const profileResult = await deps.getCurrentProfile(user.id)
  const profileState = readExistingProfileState(profileResult)

  if (profileState.status === "failure") {
    return profileState
  }

  const updated = await deps.updateProfile(
    user.id,
    buildProfileUpdate(request, profileState.profile, deps),
  )

  if (updated.errorCode || !updated.profile) {
    return internalError()
  }

  return readProfileResponse(updated.profile, deps, 200)
}

function readExistingProfileState(
  profileResult: ProfileReadResult,
): WorkflowFailure | Readonly<{ profile: ProfileRow; status: "success" }> {
  if (profileResult.errorCode) {
    return internalError()
  }

  if (!profileResult.profile) {
    return failure("PROFILE_REQUIRED", "Profile setup required.", 409)
  }

  const accountError = getAccountStateError(profileResult.profile)

  if (accountError) {
    return accountError
  }

  return { profile: profileResult.profile, status: "success" }
}

async function readProfileResponse(
  profile: ProfileRow,
  deps: ProfileWorkflowDependencies,
  statusCode: number,
): Promise<WorkflowResult<ProfileResponse>> {
  const coachResult = await deps.getCoachProfile(profile.id)

  if (coachResult.errorCode) {
    return internalError()
  }

  return {
    response: { data: mapProfileData(profile, coachResult.coachProfile) },
    status: "success",
    statusCode,
  }
}

function buildProfileUpdate(
  request: PatchProfileRequest,
  profile: ProfileRow,
  deps: ProfileWorkflowDependencies,
): ProfileUpdateInput {
  const patch: {
    avatar_path?: string | null
    default_region?: string | null
    display_name?: string
    location_agreed_at?: string | null
    marketing_agreed_at?: string | null
    phone?: string | null
    real_name?: string | null
  } = {}

  if (Object.hasOwn(request, "avatarPath")) patch.avatar_path = request.avatarPath ?? null
  if (Object.hasOwn(request, "defaultRegion")) patch.default_region = request.defaultRegion ?? null
  if (typeof request.displayName === "string") patch.display_name = request.displayName
  if (Object.hasOwn(request, "phone")) patch.phone = request.phone ?? null
  if (Object.hasOwn(request, "realName")) patch.real_name = request.realName ?? null
  if (request.locationAgreed === false) patch.location_agreed_at = null
  if (request.locationAgreed === true && profile.location_agreed_at === null) {
    patch.location_agreed_at = readNow(deps)
  }
  if (request.marketingAgreed === false) patch.marketing_agreed_at = null
  if (request.marketingAgreed === true && profile.marketing_agreed_at === null) {
    patch.marketing_agreed_at = readNow(deps)
  }

  return patch
}

function mapProfileData(profile: ProfileRow, coachProfile: CoachProfileRow | null): ProfileData {
  return {
    id: profile.id,
    role: profile.role,
    status: profile.status,
    displayName: profile.display_name,
    realName: profile.real_name,
    phone: profile.phone,
    avatarPath: profile.avatar_path,
    defaultRegion: profile.default_region,
    locationAgreedAt: toUtcIsoOrNull(profile.location_agreed_at),
    marketingAgreedAt: toUtcIsoOrNull(profile.marketing_agreed_at),
    deletedAt: toUtcIsoOrNull(profile.deleted_at),
    coachProfile: coachProfile
      ? {
          id: coachProfile.id,
          status: coachProfile.status,
          headline: coachProfile.headline,
          serviceRegion: coachProfile.service_region,
        }
      : null,
  }
}

function getAccountStateError(profile: ProfileRow): WorkflowFailure | null {
  if (profile.status === "deleted" || profile.deleted_at !== null) {
    return failure("ACCOUNT_DELETED", "Account is unavailable.", 403)
  }

  if (profile.status === "suspended") {
    return failure("ACCOUNT_SUSPENDED", "Account is suspended.", 403)
  }

  return null
}

function failure(code: string, message: string, statusCode: number): WorkflowFailure {
  return { error: { code, message, statusCode }, status: "failure" }
}

function internalError(): WorkflowFailure {
  return failure("INTERNAL_ERROR", "Unable to complete profile request.", 500)
}

function readNow(deps: ProfileWorkflowDependencies): string {
  return deps.now?.() ?? new Date().toISOString()
}

function toUtcIsoOrNull(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString()
}
