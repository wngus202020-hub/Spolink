import {
  LESSON_IMAGE_ALLOWED_MIME_TYPES,
  LESSON_IMAGE_MAX_BYTES,
  LESSON_IMAGE_MAX_IDS,
} from "@/lib/lessons/lesson-image-contract"

export const LESSON_IMAGE_MANAGER_MAX_BYTES = LESSON_IMAGE_MAX_BYTES

type LessonImageFile = Pick<File, "name" | "size" | "type">

export type LessonImageManagerExistingImage = Readonly<{
  id: string
  kind: "existing"
  previewUrl: string
  status: "deleting" | "registered"
}>

export type LessonImageManagerQueuedImage = Readonly<{
  errorMessage?: string | undefined
  file: File
  id: string
  kind: "queued"
  status: "failed" | "queued" | "uploading"
}>

export type LessonImageManagerItem = LessonImageManagerExistingImage | LessonImageManagerQueuedImage

export type LessonImageManagerItemReference = Readonly<{
  id: string
  kind: LessonImageManagerItem["kind"]
}>

export type LessonImageManagerDeleteResult =
  | Readonly<{ status: "success" }>
  | Readonly<{ message: string; status: "error" }>

export type LessonImageSelectionResult =
  | Readonly<{ files: readonly LessonImageFile[]; status: "success" }>
  | Readonly<{ message: string; status: "error" }>

type PreviewUrlApi = Readonly<{
  createObjectURL: (file: File) => string
  revokeObjectURL: (url: string) => void
}>

type PreviewEntry = Readonly<{ file: File; url: string }>

export class LessonImagePreviewRegistry {
  #entries = new Map<string, PreviewEntry>()

  constructor(private readonly urls: PreviewUrlApi) {}

  dispose() {
    for (const entry of this.#entries.values()) this.urls.revokeObjectURL(entry.url)
    this.#entries.clear()
  }

  reconcile(items: readonly LessonImageManagerQueuedImage[]) {
    const nextEntries = new Map<string, PreviewEntry>()
    for (const item of items) {
      const previous = this.#entries.get(item.id)
      nextEntries.set(
        item.id,
        previous?.file === item.file
          ? previous
          : { file: item.file, url: this.urls.createObjectURL(item.file) },
      )
    }
    for (const [id, entry] of this.#entries) {
      if (nextEntries.get(id) !== entry) this.urls.revokeObjectURL(entry.url)
    }
    this.#entries = nextEntries
    return new Map([...nextEntries].map(([id, entry]) => [id, entry.url]))
  }

  release(id: string) {
    const entry = this.#entries.get(id)
    if (!entry) return
    this.urls.revokeObjectURL(entry.url)
    this.#entries.delete(id)
  }
}

export function validateLessonImageSelection(
  input: Readonly<{
    currentItemCount: number
    files: readonly LessonImageFile[]
  }>,
): LessonImageSelectionResult {
  if (input.files.length === 0) return { message: "선택한 이미지가 없습니다.", status: "error" }
  if (input.currentItemCount + input.files.length > LESSON_IMAGE_MAX_IDS) {
    return { message: "레슨 이미지는 최대 5장까지 추가할 수 있습니다.", status: "error" }
  }
  for (const file of input.files) {
    if (!LESSON_IMAGE_ALLOWED_MIME_TYPES.some((mimeType) => mimeType === file.type)) {
      return { message: "JPEG, PNG, WebP 이미지만 선택할 수 있습니다.", status: "error" }
    }
    if (file.size === 0) return { message: "0바이트 파일은 추가할 수 없습니다.", status: "error" }
    if (file.size > LESSON_IMAGE_MANAGER_MAX_BYTES) {
      return { message: "이미지 한 장은 5MiB 이하여야 합니다.", status: "error" }
    }
  }
  return { files: input.files, status: "success" }
}

export function moveLessonImageManagerItem<T extends Readonly<{ id: string }>>(
  items: readonly T[],
  itemId: string,
  destinationIndex: number,
) {
  const sourceIndex = items.findIndex((item) => item.id === itemId)
  if (sourceIndex < 0 || destinationIndex < 0 || destinationIndex >= items.length) return items
  const nextItems = [...items]
  const [item] = nextItems.splice(sourceIndex, 1)
  if (!item) return items
  nextItems.splice(destinationIndex, 0, item)
  return nextItems
}

export function queuedItems(items: readonly LessonImageManagerItem[]) {
  return items.filter((item): item is LessonImageManagerQueuedImage => item.kind === "queued")
}

export function toItemReference(item: LessonImageManagerItem): LessonImageManagerItemReference {
  return { id: item.id, kind: item.kind }
}
