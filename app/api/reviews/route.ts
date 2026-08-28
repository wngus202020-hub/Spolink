import { createReviewRouteHandler } from "@/lib/reviews/route-handler"
import { createReviewRouteSession } from "@/lib/reviews/server"
import { getSupabaseConfigStatus } from "@/lib/supabase/env"
export const POST = createReviewRouteHandler({
  configured: () => getSupabaseConfigStatus().configured,
  createClient: async (headers) => createReviewRouteSession(headers),
})
