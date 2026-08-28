import type { LessonDraftInput } from "@/lib/lessons/authoring-contract"
import type { LessonAuthoringData } from "@/lib/lessons/authoring-types"

type DraftResult =
  | Readonly<{ data: LessonAuthoringData; status: "success" }>
  | Readonly<{ message: string; status: "failure"; statusCode: number }>

type NewLessonSubmissionInput = Readonly<{
  createDraft: (draft: LessonDraftInput) => Promise<DraftResult>
  draft: LessonDraftInput
  draftId: string | null
  updateDraft: (
    lessonId: string,
    draft: LessonDraftInput & Readonly<{ expectedUpdatedAt: string }>,
  ) => Promise<DraftResult>
  uploadImages: (lessonId: string) => Promise<boolean>
  version: string | null
}>

export type NewLessonSubmissionResult =
  | Readonly<{ message: string; status: "draft_failure"; statusCode: number }>
  | Readonly<{
      draftId: string
      status: "image_failure"
      updatedAt: string
    }>
  | Readonly<{
      draftId: string
      redirectHref: string
      status: "success"
      updatedAt: string
    }>

export async function runNewLessonSubmission({
  createDraft,
  draft,
  draftId,
  updateDraft,
  uploadImages,
  version,
}: NewLessonSubmissionInput): Promise<NewLessonSubmissionResult> {
  if (draftId && !version) {
    return {
      message: "저장된 초안 버전을 확인하지 못했습니다.",
      status: "draft_failure",
      statusCode: 409,
    }
  }
  const draftResult =
    draftId && version
      ? await updateDraft(draftId, { ...draft, expectedUpdatedAt: version })
      : await createDraft(draft)
  if (draftResult.status === "failure") {
    return {
      message: draftResult.message,
      status: "draft_failure",
      statusCode: draftResult.statusCode,
    }
  }

  const uploaded = await uploadImages(draftResult.data.id)
  if (!uploaded) {
    return {
      draftId: draftResult.data.id,
      status: "image_failure",
      updatedAt: draftResult.data.updatedAt,
    }
  }
  return {
    draftId: draftResult.data.id,
    redirectHref: `/coach/lessons/${draftResult.data.id}/edit`,
    status: "success",
    updatedAt: draftResult.data.updatedAt,
  }
}
