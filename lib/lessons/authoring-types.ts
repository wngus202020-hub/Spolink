import type { Database } from "../supabase/database.types"
import type {
  LessonDraftInput,
  LessonTransitionInput,
  LessonUpdateInput,
  ScheduleCloseInput,
  ScheduleCreateInput,
  ScheduleUpdateInput,
} from "./authoring-contract"

export type LessonRow = Database["public"]["Tables"]["lessons"]["Row"]
export type ScheduleRow = Database["public"]["Tables"]["lesson_schedules"]["Row"]

export type AuthoringAccess =
  | { readonly kind: "admin" }
  | { readonly coachProfileId: string; readonly kind: "approved_coach" }
  | { readonly coachProfileId: string | null; readonly kind: "pending_coach" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "unauthenticated" }

export type RepositoryResult<T> = Readonly<{
  data: T | null
  errorCode: string | null
}>

export interface LessonAuthoringDependencies {
  closeSchedule(
    lessonId: string,
    scheduleId: string,
    input: ScheduleCloseInput,
  ): Promise<RepositoryResult<ScheduleRow>>
  createLesson(input: LessonDraftInput): Promise<RepositoryResult<LessonRow>>
  createSchedule(
    lessonId: string,
    input: ScheduleCreateInput,
  ): Promise<RepositoryResult<ScheduleRow>>
  getActorAccess(): Promise<AuthoringAccess>
  transitionLesson(
    lessonId: string,
    input: LessonTransitionInput,
  ): Promise<RepositoryResult<LessonRow>>
  updateLesson(lessonId: string, input: LessonUpdateInput): Promise<RepositoryResult<LessonRow>>
  updateSchedule(
    lessonId: string,
    scheduleId: string,
    input: ScheduleUpdateInput,
  ): Promise<RepositoryResult<ScheduleRow>>
}

export type LessonAuthoringData = Readonly<{
  id: string
  status: LessonRow["status"]
  title: string
  updatedAt: string
}>

export type ScheduleAuthoringData = Readonly<{
  capacity: number
  endsAt: string
  id: string
  isOpen: boolean
  lessonId: string
  reservedCount: number
  startsAt: string
  updatedAt: string
}>
