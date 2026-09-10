import type { NotificationData, NotificationType } from "./types"

export type PushDeliveryClaim = Readonly<{
  attempt: number
  auth: string
  body: string | null
  claimToken: string
  data: NotificationData | null
  deliveryId: string
  endpoint: string
  notificationId: string
  p256dh: string
  title: string
  type: NotificationType
}>

export type PushDeliveryOutcome = Readonly<
  { status: "delivered" } | { errorCode: string; status: "expired" | "failed" | "retry" }
>

export type PushDeliveryDependencies = Readonly<{
  claim: (limit: number) => Promise<readonly PushDeliveryClaim[]>
  record: (deliveryId: string, claimToken: string, outcome: PushDeliveryOutcome) => Promise<void>
  send: (delivery: PushDeliveryClaim) => Promise<PushDeliveryOutcome>
}>

export type PushDeliveryBatchResult = Readonly<{
  claimed: number
  delivered: number
  expired: number
  failed: number
  retry: number
}>

export async function runPushDeliveryBatch(
  limit: number,
  dependencies: PushDeliveryDependencies,
): Promise<PushDeliveryBatchResult> {
  const deliveries = await dependencies.claim(limit)
  const outcomes = await Promise.all(
    deliveries.map(async (delivery) => {
      const outcome = await dependencies.send(delivery)
      await dependencies.record(delivery.deliveryId, delivery.claimToken, outcome)
      return outcome
    }),
  )

  let delivered = 0
  let expired = 0
  let failed = 0
  let retry = 0
  for (const outcome of outcomes) {
    switch (outcome.status) {
      case "delivered":
        delivered += 1
        break
      case "expired":
        expired += 1
        break
      case "failed":
        failed += 1
        break
      case "retry":
        retry += 1
        break
      default:
        outcome satisfies never
    }
  }
  return { claimed: deliveries.length, delivered, expired, failed, retry }
}
