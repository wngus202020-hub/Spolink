import type { SupabaseAppClient } from "@/lib/supabase/server"
import type { PushSubscriptionDisable, StoredPushSubscription } from "./push-contract"

export type PushSubscriptionRepository = Readonly<{
  disable: (
    profileId: string,
    subscription: PushSubscriptionDisable,
  ) => Promise<"disabled" | "not_found" | "error">
  save: (profileId: string, subscription: StoredPushSubscription) => Promise<"saved" | "error">
}>

export function createPushSubscriptionRepository(
  client: SupabaseAppClient,
): PushSubscriptionRepository {
  return {
    disable: async (_profileId, subscription) => {
      const result = await client.rpc("disable_push_subscription", {
        checked_endpoint: subscription.endpoint,
      })
      if (result.error) return "error"
      return result.data ? "disabled" : "not_found"
    },
    save: async (_profileId, subscription) => {
      const result = await client.rpc("upsert_push_subscription", {
        checked_auth: subscription.keys.auth,
        checked_endpoint: subscription.endpoint,
        checked_expiration_time:
          subscription.expirationTime === null
            ? null
            : new Date(subscription.expirationTime).toISOString(),
        checked_p256dh: subscription.keys.p256dh,
      })
      return result.error ? "error" : "saved"
    },
  }
}
