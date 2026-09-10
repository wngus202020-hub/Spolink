import { z } from "zod"
import { readWebPushEnv } from "@/lib/supabase/env"
import { createSupabaseServiceClient } from "@/lib/supabase/server"
import type { PushDeliveryClaim, PushDeliveryDependencies } from "./push-delivery-worker"
import { createWebPushSender } from "./push-provider"
import type { NotificationData } from "./types"

const notificationDataSchema = z.record(
  z.string(),
  z.union([z.boolean(), z.null(), z.number(), z.string()]),
)

export class PushDeliveryPersistenceError extends Error {
  readonly operation: "claim" | "record"

  constructor(operation: "claim" | "record") {
    super(`Push delivery ${operation} failed.`)
    this.name = "PushDeliveryPersistenceError"
    this.operation = operation
  }
}

export function createPushDeliveryDependencies(): PushDeliveryDependencies {
  const service = createSupabaseServiceClient()
  return {
    claim: async (limit) => {
      const result = await service.rpc("claim_notification_push_deliveries", {
        checked_limit: limit,
      })
      if (result.error) throw new PushDeliveryPersistenceError("claim")
      return (result.data ?? []).map(mapClaim)
    },
    record: async (deliveryId, claimToken, outcome) => {
      const result = await service.rpc("record_notification_push_delivery_result", {
        checked_action: outcome.status,
        checked_claim_token: claimToken,
        checked_delivery_id: deliveryId,
        checked_error_code: outcome.status === "delivered" ? null : outcome.errorCode,
      })
      if (result.error) throw new PushDeliveryPersistenceError("record")
    },
    send: createWebPushSender(readWebPushEnv()),
  }
}

function mapClaim(row: {
  attempt: number
  auth: string
  body: string | null
  claim_token: string
  data: unknown
  delivery_id: string
  endpoint: string
  notification_id: string
  notification_type: PushDeliveryClaim["type"]
  p256dh: string
  title: string
}): PushDeliveryClaim {
  return {
    attempt: row.attempt,
    auth: row.auth,
    body: row.body,
    claimToken: row.claim_token,
    data: parseData(row.data),
    deliveryId: row.delivery_id,
    endpoint: row.endpoint,
    notificationId: row.notification_id,
    p256dh: row.p256dh,
    title: row.title,
    type: row.notification_type,
  }
}

function parseData(value: unknown): NotificationData | null {
  const parsed = notificationDataSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
