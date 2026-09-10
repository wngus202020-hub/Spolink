import { z } from "zod"

export const PROFILE_AVATAR_BUCKET = "profile-avatars"
export const PROFILE_AVATAR_MAX_BYTES = 5 * 1024 * 1024
export const PROFILE_AVATAR_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const

const profileAvatarMimeTypeSchema = z.enum(PROFILE_AVATAR_ALLOWED_MIME_TYPES)
const profileOwnerIdSchema = z.uuid()

export type ProfileAvatarMimeType = z.infer<typeof profileAvatarMimeTypeSchema>

export type ProfileAvatarFileResult = Readonly<
  | { mimeType: ProfileAvatarMimeType; sizeBytes: number; status: "success" }
  | { reason: "empty" | "size" | "type"; status: "failure" }
>

export function parseProfileAvatarFile(file: Blob): ProfileAvatarFileResult {
  if (file.size === 0) return { reason: "empty", status: "failure" }
  if (file.size > PROFILE_AVATAR_MAX_BYTES) return { reason: "size", status: "failure" }

  const mimeType = profileAvatarMimeTypeSchema.safeParse(file.type)
  if (!mimeType.success) return { reason: "type", status: "failure" }

  return { mimeType: mimeType.data, sizeBytes: file.size, status: "success" }
}

export function buildProfileAvatarObjectName(userId: string): string | null {
  const ownerId = profileOwnerIdSchema.safeParse(userId)
  return ownerId.success ? `profiles/${ownerId.data}/avatar` : null
}

type BoundaryResult = Readonly<{ status: "failure" | "success" }>

export type ProfileAvatarClientDependencies = Readonly<{
  patchAvatarPath: (avatarPath: string | null) => Promise<BoundaryResult>
  removeObject: (objectName: string) => Promise<BoundaryResult>
  uploadObject: (objectName: string, file: Blob) => Promise<BoundaryResult>
}>

type ProfileAvatarFailure = Readonly<{
  reason: "file" | "owner" | "profile" | "storage"
  status: "failure"
}>

export type ProfileAvatarReplaceResult = Readonly<
  { avatarPath: string; status: "success" } | ProfileAvatarFailure
>

export type ProfileAvatarRemoveResult = Readonly<{ status: "success" } | ProfileAvatarFailure>

type ReplaceProfileAvatarInput = Readonly<{
  currentAvatarPath?: string | null
  file: Blob
  userId: string
}>

export async function runReplaceProfileAvatar(
  input: ReplaceProfileAvatarInput,
  dependencies: ProfileAvatarClientDependencies,
): Promise<ProfileAvatarReplaceResult> {
  if (parseProfileAvatarFile(input.file).status === "failure") {
    return { reason: "file", status: "failure" }
  }

  const avatarPath = buildProfileAvatarObjectName(input.userId)
  if (!avatarPath) return { reason: "owner", status: "failure" }

  const uploaded = await dependencies.uploadObject(avatarPath, input.file)
  if (uploaded.status === "failure") return { reason: "storage", status: "failure" }

  const patched = await dependencies.patchAvatarPath(avatarPath)
  if (patched.status === "failure") {
    if (input.currentAvatarPath === null || input.currentAvatarPath === undefined) {
      await dependencies.removeObject(avatarPath)
    }
    return { reason: "profile", status: "failure" }
  }

  return { avatarPath, status: "success" }
}

export async function runRemoveProfileAvatar(
  currentAvatarPath: string,
  dependencies: ProfileAvatarClientDependencies,
): Promise<ProfileAvatarRemoveResult> {
  const patched = await dependencies.patchAvatarPath(null)
  if (patched.status === "failure") return { reason: "profile", status: "failure" }

  const removed = await dependencies.removeObject(currentAvatarPath)
  return removed.status === "success"
    ? { status: "success" }
    : { reason: "storage", status: "failure" }
}
