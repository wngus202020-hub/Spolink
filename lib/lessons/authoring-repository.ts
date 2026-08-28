import type { SupabaseClient } from "@supabase/supabase-js"

import { readVerifiedClaims } from "../auth/claims"
import type { Database } from "../supabase/database.types"
import type {
  LessonDraftInput,
  LessonTransitionInput,
  LessonUpdateInput,
} from "./authoring-contract"
import type { LessonAuthoringDependencies } from "./authoring-types"

type LessonFunctions = Readonly<{
  close_lesson_schedule: Rpc<
    { checked_expected_updated_at: string; checked_lesson_id: string; checked_schedule_id: string },
    readonly ScheduleRow[]
  >
  create_lesson_draft: Rpc<LessonDraftArgs, readonly LessonRow[]>
  create_lesson_schedule: Rpc<
    {
      checked_capacity: number
      checked_ends_at: string
      checked_lesson_id: string
      checked_starts_at: string
    },
    readonly ScheduleRow[]
  >
  transition_lesson: Rpc<
    {
      checked_action: LessonTransitionInput["action"]
      checked_expected_updated_at: string
      checked_lesson_id: string
      checked_reason?: string | null
    },
    readonly LessonRow[]
  >
  update_lesson_draft: Rpc<
    LessonDraftArgs & { checked_expected_updated_at: string; checked_lesson_id: string },
    readonly LessonRow[]
  >
  update_lesson_schedule: Rpc<
    {
      checked_capacity: number
      checked_ends_at: string
      checked_expected_updated_at: string
      checked_lesson_id: string
      checked_schedule_id: string
      checked_starts_at: string
    },
    readonly ScheduleRow[]
  >
}>

type LessonDraftArgs = ReturnType<typeof lessonArgs>
type LessonRow = Database["public"]["Tables"]["lessons"]["Row"]
type ScheduleRow = Database["public"]["Tables"]["lesson_schedules"]["Row"]
type Rpc<Args, Returns> = Readonly<{ Args: Args; Returns: Returns }>

export type LessonAuthoringDatabase = Readonly<{
  public: Omit<Database["public"], "Functions"> & {
    Functions: Database["public"]["Functions"] & LessonFunctions
  }
}>

type SupabaseAppClient = SupabaseClient<LessonAuthoringDatabase>

const RPC_DOMAIN_ERRORS = new Set([
  "COACH_NOT_APPROVED",
  "FORBIDDEN",
  "IMAGE_OPERATION_PENDING",
  "LESSON_NOT_FOUND",
  "LESSON_STATE_CONFLICT",
  "SCHEDULE_HAS_CONFIRMED_RESERVATION",
  "SCHEDULE_NOT_FOUND",
  "STALE_LESSON",
  "STALE_SCHEDULE",
  "UNAUTHORIZED",
  "VALIDATION_ERROR",
])

export function createLessonAuthoringDependencies(
  supabase: SupabaseAppClient,
): LessonAuthoringDependencies {
  return {
    closeSchedule: async (lessonId, scheduleId, input) => {
      const { data, error } = await supabase.rpc("close_lesson_schedule", {
        checked_expected_updated_at: input.expectedUpdatedAt,
        checked_lesson_id: lessonId,
        checked_schedule_id: scheduleId,
      })
      return { data: data?.[0] ?? null, errorCode: normalizeRpcError(error) }
    },
    createLesson: async (input) => {
      const { data, error } = await supabase.rpc("create_lesson_draft", lessonArgs(input))
      return { data: data?.[0] ?? null, errorCode: normalizeRpcError(error) }
    },
    createSchedule: async (lessonId, input) => {
      const { data, error } = await supabase.rpc("create_lesson_schedule", {
        checked_capacity: input.capacity,
        checked_ends_at: input.endsAt,
        checked_lesson_id: lessonId,
        checked_starts_at: input.startsAt,
      })
      return { data: data?.[0] ?? null, errorCode: normalizeRpcError(error) }
    },
    getActorAccess: () => readActorAccess(supabase),
    transitionLesson: async (lessonId, input) => {
      const { data, error } = await supabase.rpc("transition_lesson", {
        checked_action: input.action,
        checked_expected_updated_at: input.expectedUpdatedAt,
        checked_lesson_id: lessonId,
        checked_reason: input.reason ?? null,
      })
      return { data: data?.[0] ?? null, errorCode: normalizeRpcError(error) }
    },
    updateLesson: async (lessonId, input) => {
      const { data, error } = await supabase.rpc("update_lesson_draft", {
        checked_expected_updated_at: input.expectedUpdatedAt,
        checked_lesson_id: lessonId,
        ...lessonArgs(input),
      })
      return { data: data?.[0] ?? null, errorCode: normalizeRpcError(error) }
    },
    updateSchedule: async (lessonId, scheduleId, input) => {
      const { data, error } = await supabase.rpc("update_lesson_schedule", {
        checked_capacity: input.capacity,
        checked_ends_at: input.endsAt,
        checked_expected_updated_at: input.expectedUpdatedAt,
        checked_lesson_id: lessonId,
        checked_schedule_id: scheduleId,
        checked_starts_at: input.startsAt,
      })
      return { data: data?.[0] ?? null, errorCode: normalizeRpcError(error) }
    },
  }
}

function lessonArgs(input: LessonDraftInput | LessonUpdateInput) {
  return {
    checked_address: input.address ?? null,
    checked_cancellation_policy_summary: input.cancellationPolicySummary ?? null,
    checked_capacity: input.capacity,
    checked_description: input.description,
    checked_duration_minutes: input.durationMinutes,
    checked_place_name: input.placeName ?? null,
    checked_preparation: input.preparation ?? null,
    checked_price_amount: input.priceAmount,
    checked_region: input.region,
    checked_sport_id: input.sportId,
    checked_summary: input.summary ?? null,
    checked_title: input.title,
  }
}

async function readActorAccess(supabase: SupabaseAppClient) {
  const { data, error } = await supabase.auth.getClaims()
  const claims = error ? null : readVerifiedClaims(data?.claims)
  if (!claims) return { kind: "unauthenticated" as const }

  const [{ data: profile }, { data: coach }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,role,status,deleted_at")
      .eq("id", claims.sub)
      .maybeSingle(),
    supabase.from("coach_profiles").select("id,status").eq("user_id", claims.sub).maybeSingle(),
  ])
  if (!profile || profile.deleted_at !== null || profile.status === "suspended") {
    return { kind: "forbidden" as const }
  }
  if (profile.role === "admin" && profile.status === "active") {
    return { kind: "admin" as const }
  }
  if (profile.status === "coach_approved" && coach?.status === "approved") {
    return { coachProfileId: coach.id, kind: "approved_coach" as const }
  }
  return { coachProfileId: coach?.id ?? null, kind: "pending_coach" as const }
}

function normalizeRpcError(error: Readonly<{ code: string; message: string }> | null) {
  if (!error) return null
  if (error.code === "P0001" && RPC_DOMAIN_ERRORS.has(error.message)) return error.message
  return error.code
}
