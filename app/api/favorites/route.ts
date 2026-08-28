import { createFavoriteMutationWorkflowDependencies } from "@/lib/favorites/mutation-repository"
import {
  createFavoriteMutationRouteHandler,
  getVerifiedFavoriteUserId,
} from "@/lib/favorites/mutation-route-handler"
import { createFavoriteMutationClient } from "@/lib/favorites/mutation-session"
import { runFavoriteMutationWorkflow } from "@/lib/favorites/mutation-workflow"
import { getSupabaseConfigStatus } from "@/lib/supabase/env"

const dependencies = {
  createSession: async (responseHeaders: Headers) => {
    const client = await createFavoriteMutationClient(responseHeaders)
    return {
      getVerifiedUserId: () => getVerifiedFavoriteUserId(client),
      workflowDependencies: createFavoriteMutationWorkflowDependencies(client),
    }
  },
  isConfigured: () => getSupabaseConfigStatus().configured,
  runWorkflow: runFavoriteMutationWorkflow,
}

export const POST = createFavoriteMutationRouteHandler("add", dependencies)
export const DELETE = createFavoriteMutationRouteHandler("remove", dependencies)
