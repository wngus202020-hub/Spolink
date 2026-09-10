import webPush from "web-push"
import { z } from "zod"

import type { WebPushEnv } from "@/lib/supabase/env"
import type { PushDeliveryClaim, PushDeliveryOutcome } from "./push-delivery-worker"

const providerErrorSchema = z.object({ statusCode: z.number().int() }).passthrough()
const networkErrorSchema = z
  .object({
    code: z.enum([
      "ECONNABORTED",
      "ECONNREFUSED",
      "ECONNRESET",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ETIMEDOUT",
    ]),
  })
  .passthrough()

export function createWebPushSender(env: WebPushEnv) {
  return async (delivery: PushDeliveryClaim): Promise<PushDeliveryOutcome> => {
    try {
      await webPush.sendNotification(
        {
          endpoint: delivery.endpoint,
          keys: { auth: delivery.auth, p256dh: delivery.p256dh },
        },
        JSON.stringify({
          body: delivery.body,
          notificationId: delivery.notificationId,
          title: delivery.title,
          url: "/mypage/notifications",
        }),
        {
          TTL: 60 * 60,
          timeout: 10_000,
          urgency: "high",
          vapidDetails: {
            privateKey: env.privateKey,
            publicKey: env.publicKey,
            subject: env.subject,
          },
        },
      )
      return { status: "delivered" }
    } catch (error) {
      return classifyWebPushFailure(error)
    }
  }
}

export function classifyWebPushFailure(error: unknown): PushDeliveryOutcome {
  const providerError = providerErrorSchema.safeParse(error)
  if (providerError.success) return classifyProviderStatus(providerError.data.statusCode)
  if (networkErrorSchema.safeParse(error).success) {
    return { errorCode: "PUSH_NETWORK_ERROR", status: "retry" }
  }
  if (error instanceof Error) {
    return { errorCode: "PUSH_SUBSCRIPTION_INVALID", status: "failed" }
  }
  throw error
}

function classifyProviderStatus(statusCode: number): PushDeliveryOutcome {
  if (statusCode === 400 || statusCode === 404 || statusCode === 410) {
    return { errorCode: "PUSH_SUBSCRIPTION_EXPIRED", status: "expired" }
  }
  if (statusCode === 408 || statusCode === 429 || statusCode >= 500) {
    return {
      errorCode: statusCode === 429 ? "PUSH_RATE_LIMITED" : "PUSH_PROVIDER_UNAVAILABLE",
      status: "retry",
    }
  }
  return { errorCode: "PUSH_PROVIDER_REJECTED", status: "failed" }
}
