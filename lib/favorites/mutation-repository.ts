import { z } from "zod"

import type { FavoriteMutationClient } from "./mutation-session"
import type {
  FavoriteMutationAction,
  FavoriteMutationWorkflowDependencies,
} from "./mutation-workflow"

const addRowSchema = z.object({ favorite_added: z.boolean(), lesson_id: z.uuid() }).strict()
const removeRowSchema = z.object({ favorite_removed: z.boolean(), lesson_id: z.uuid() }).strict()

export function createFavoriteMutationWorkflowDependencies(
  client: FavoriteMutationClient,
): FavoriteMutationWorkflowDependencies {
  return {
    getCurrentProfile: async (userId) => {
      const { data: profile, error } = await client
        .from("profiles")
        .select("id,role,status,deleted_at")
        .eq("id", userId)
        .maybeSingle()

      return {
        errorCode: error?.code ?? null,
        profile: profile
          ? {
              deletedAt: profile.deleted_at,
              role: profile.role,
              status: profile.status,
            }
          : null,
      }
    },
    mutateFavorite: async ({ action, lessonId }) => mutateFavorite(client, action, lessonId),
  }
}

async function mutateFavorite(
  client: FavoriteMutationClient,
  action: FavoriteMutationAction,
  lessonId: string,
) {
  switch (action) {
    case "add": {
      const { data, error } = await client.rpc("add_lesson_favorite", {
        checked_lesson_id: lessonId,
      })
      const parsed = addRowSchema.safeParse(data?.[0])
      return {
        errorCode: error?.message ?? (parsed.success ? null : "INVALID_RPC_RESPONSE"),
        row: parsed.success
          ? { changed: parsed.data.favorite_added, lessonId: parsed.data.lesson_id }
          : null,
      }
    }
    case "remove": {
      const { data, error } = await client.rpc("remove_lesson_favorite", {
        checked_lesson_id: lessonId,
      })
      const parsed = removeRowSchema.safeParse(data?.[0])
      return {
        errorCode: error?.message ?? (parsed.success ? null : "INVALID_RPC_RESPONSE"),
        row: parsed.success
          ? { changed: parsed.data.favorite_removed, lessonId: parsed.data.lesson_id }
          : null,
      }
    }
  }
}
