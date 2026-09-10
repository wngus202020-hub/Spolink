import { getSupabaseConfigStatus, getWebPushConfigStatus } from "@/lib/supabase/env"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { readNotificationAccess } from "./default-dependencies"
import { createPushSubscriptionRepository } from "./push-subscription-repository"
import { createPushSubscriptionRouteHandler } from "./push-subscription-route-handlers"

export const pushSubscriptionRouteHandler = createPushSubscriptionRouteHandler({
  createContext: async (headers) => {
    const client = await createSupabaseServerClient(headers)
    return {
      access: await readNotificationAccess(client),
      repository: createPushSubscriptionRepository(client),
    }
  },
  isPushConfigured: () => getWebPushConfigStatus().configured,
  isSupabaseConfigured: () => getSupabaseConfigStatus().configured,
})
