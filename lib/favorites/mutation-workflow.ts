import { z } from "zod"

const favoriteMutationRequestSchema = z.object({ lessonId: z.string().trim().uuid() }).strict()

export type FavoriteMutationAction = "add" | "remove"

export type FavoriteMutationRequest = Readonly<{
  lessonId: string
}>

export type FavoriteMutationRequestParseResult = Readonly<
  { request: FavoriteMutationRequest; status: "success" } | { status: "failure" }
>

type FavoriteProfile = Readonly<{
  deletedAt: string | null
  role: "admin" | "coach" | "learner"
  status: "active" | "coach_approved" | "deleted" | "pending_coach" | "suspended"
}>

type FavoriteProfileResult = Readonly<{
  errorCode: string | null
  profile: FavoriteProfile | null
}>

type FavoritePersistenceResult = Readonly<{
  errorCode: string | null
  row: Readonly<{ changed: boolean; lessonId: string }> | null
}>

export type FavoriteMutationWorkflowDependencies = Readonly<{
  getCurrentProfile: (userId: string) => Promise<FavoriteProfileResult>
  mutateFavorite: (
    input: Readonly<{ action: FavoriteMutationAction; lessonId: string }>,
  ) => Promise<FavoritePersistenceResult>
}>

export type FavoriteMutationWorkflowInput = Readonly<{
  action: FavoriteMutationAction
  request: FavoriteMutationRequest
  userId: string
}>

export type FavoriteMutationResponse = Readonly<{
  data: Readonly<{
    changed: boolean
    favorited: boolean
    lessonId: string
  }>
}>

export type FavoriteMutationError = Readonly<{
  code:
    | "ACCOUNT_DELETED"
    | "ACCOUNT_SUSPENDED"
    | "FORBIDDEN"
    | "INTERNAL_ERROR"
    | "LESSON_NOT_ACTIVE"
    | "PROFILE_REQUIRED"
    | "UNAUTHORIZED"
  message: string
  statusCode: 401 | 403 | 409 | 500
}>

export type FavoriteMutationWorkflowResult = Readonly<
  | {
      response: FavoriteMutationResponse
      status: "success"
      statusCode: 200 | 201
    }
  | { error: FavoriteMutationError; status: "failure" }
>

export function parseFavoriteMutationRequest(body: unknown): FavoriteMutationRequestParseResult {
  const parsed = favoriteMutationRequestSchema.safeParse(body)
  return parsed.success ? { request: parsed.data, status: "success" } : { status: "failure" }
}

export async function runFavoriteMutationWorkflow(
  input: FavoriteMutationWorkflowInput,
  dependencies: FavoriteMutationWorkflowDependencies,
): Promise<FavoriteMutationWorkflowResult> {
  const profileResult = await dependencies.getCurrentProfile(input.userId)
  if (profileResult.errorCode !== null) return failure("INTERNAL_ERROR")
  if (!profileResult.profile) return failure("PROFILE_REQUIRED")

  const profileFailure = readProfileFailure(profileResult.profile)
  if (profileFailure) return profileFailure

  const mutation = await dependencies.mutateFavorite({
    action: input.action,
    lessonId: input.request.lessonId,
  })
  if (mutation.errorCode !== null) return failure(mapPersistenceError(mutation.errorCode))
  if (!mutation.row || mutation.row.lessonId !== input.request.lessonId) {
    return failure("INTERNAL_ERROR")
  }

  return {
    response: {
      data: {
        changed: mutation.row.changed,
        favorited: input.action === "add",
        lessonId: mutation.row.lessonId,
      },
    },
    status: "success",
    statusCode: input.action === "add" && mutation.row.changed ? 201 : 200,
  }
}

function readProfileFailure(profile: FavoriteProfile) {
  if (profile.status === "deleted" || profile.deletedAt !== null) {
    return failure("ACCOUNT_DELETED")
  }
  if (profile.status === "suspended") return failure("ACCOUNT_SUSPENDED")
  if (profile.role !== "learner") return failure("FORBIDDEN")
  return null
}

function mapPersistenceError(errorCode: string): FavoriteMutationError["code"] {
  switch (errorCode) {
    case "FAVORITE_ACCOUNT_DELETED":
      return "ACCOUNT_DELETED"
    case "FAVORITE_ACCOUNT_SUSPENDED":
      return "ACCOUNT_SUSPENDED"
    case "FAVORITE_FORBIDDEN":
      return "FORBIDDEN"
    case "FAVORITE_LESSON_NOT_ACTIVE":
      return "LESSON_NOT_ACTIVE"
    case "FAVORITE_PROFILE_REQUIRED":
      return "PROFILE_REQUIRED"
    case "FAVORITE_UNAUTHORIZED":
      return "UNAUTHORIZED"
    default:
      return "INTERNAL_ERROR"
  }
}

function failure(code: FavoriteMutationError["code"]): FavoriteMutationWorkflowResult {
  switch (code) {
    case "ACCOUNT_DELETED":
      return failed(code, "Account is unavailable.", 403)
    case "ACCOUNT_SUSPENDED":
      return failed(code, "Account is suspended.", 403)
    case "FORBIDDEN":
      return failed(code, "Learner access required.", 403)
    case "LESSON_NOT_ACTIVE":
      return failed(code, "The lesson is not available for favorites.", 409)
    case "PROFILE_REQUIRED":
      return failed(code, "Profile setup required.", 409)
    case "UNAUTHORIZED":
      return failed(code, "Authentication required.", 401)
    case "INTERNAL_ERROR":
      return failed(code, "Unable to update favorite.", 500)
  }
}

function failed(
  code: FavoriteMutationError["code"],
  message: string,
  statusCode: FavoriteMutationError["statusCode"],
): FavoriteMutationWorkflowResult {
  return { error: { code, message, statusCode }, status: "failure" }
}
