import ky from "ky"
import { z } from "zod"

import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import {
  PROFILE_AVATAR_BUCKET,
  type ProfileAvatarClientDependencies,
  type ProfileAvatarRemoveResult,
  type ProfileAvatarReplaceResult,
  runRemoveProfileAvatar,
  runReplaceProfileAvatar,
} from "./avatar-contract"

const profileAvatarResponseSchema = z.strictObject({
  data: z.object({ avatarPath: z.string().nullable() }),
})

const defaultDependencies: ProfileAvatarClientDependencies = {
  patchAvatarPath: async (avatarPath) => {
    try {
      const response = await ky.patch("/api/profiles/me", {
        cache: "no-store",
        credentials: "same-origin",
        json: { avatarPath },
        retry: 0,
        throwHttpErrors: false,
        timeout: 5_000,
      })
      if (!response.ok) return { status: "failure" }
      const parsed = profileAvatarResponseSchema.safeParse(await response.json())
      return parsed.success && parsed.data.data.avatarPath === avatarPath
        ? { status: "success" }
        : { status: "failure" }
    } catch (error) {
      if (error instanceof Error) return { status: "failure" }
      throw error
    }
  },
  removeObject: async (objectName) => {
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.storage.from(PROFILE_AVATAR_BUCKET).remove([objectName])
    return error ? { status: "failure" } : { status: "success" }
  },
  uploadObject: async (objectName, file) => {
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.storage.from(PROFILE_AVATAR_BUCKET).upload(objectName, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: true,
    })
    return error ? { status: "failure" } : { status: "success" }
  },
}

export async function replaceProfileAvatar(
  input: Readonly<{ currentAvatarPath?: string | null; file: Blob; userId: string }>,
): Promise<ProfileAvatarReplaceResult> {
  return runReplaceProfileAvatar(input, defaultDependencies)
}

export async function removeProfileAvatar(
  currentAvatarPath: string,
): Promise<ProfileAvatarRemoveResult> {
  return runRemoveProfileAvatar(currentAvatarPath, defaultDependencies)
}
