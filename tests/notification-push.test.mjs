import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { register } from "node:module"
import test from "node:test"

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@/")) return nextResolve(new URL(specifier.slice(2) + ".ts", ${JSON.stringify(new URL("../", import.meta.url).href)}).href, context)
      try { return await nextResolve(specifier, context) } catch (error) {
        if (error?.code === "ERR_MODULE_NOT_FOUND" && (specifier.startsWith("./") || specifier.startsWith("../"))) return nextResolve(specifier + ".ts", context)
        throw error
      }
    }
  `)}`,
  import.meta.url,
)

const profileId = "7a000000-0000-4000-8000-000000000001"
const notificationId = "7a100000-0000-4000-8000-000000000001"
const deliveryIds = [
  "7a200000-0000-4000-8000-000000000001",
  "7a200000-0000-4000-8000-000000000002",
  "7a200000-0000-4000-8000-000000000003",
]
const subscription = {
  endpoint: "https://push.example.test/subscriptions/device-1",
  expirationTime: null,
  keys: { auth: "A".repeat(24), p256dh: "B".repeat(87) },
}

test("push subscription mutation derives the owner and rejects cross-origin input", async () => {
  const { createPushSubscriptionRouteHandler } = await import(
    "../lib/notifications/push-subscription-route-handlers.ts"
  )
  const saved = []
  const handler = createPushSubscriptionRouteHandler({
    createContext: async () => ({
      access: { profileId },
      repository: {
        disable: async () => "disabled",
        save: async (ownerId, value) => {
          saved.push({ ownerId, value })
          return "saved"
        },
      },
    }),
    isPushConfigured: () => true,
    isSupabaseConfigured: () => true,
  })

  const forbidden = await handler.POST(
    new Request("http://127.0.0.1:3000/api/notifications/push-subscriptions", {
      body: JSON.stringify(subscription),
      headers: { "Content-Type": "application/json", Origin: "https://attacker.test" },
      method: "POST",
    }),
  )
  assert.equal(forbidden.status, 403)
  assert.equal(saved.length, 0)

  const response = await handler.POST(
    new Request("http://127.0.0.1:3000/api/notifications/push-subscriptions", {
      body: JSON.stringify(subscription),
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3000" },
      method: "POST",
    }),
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(saved, [{ ownerId: profileId, value: subscription }])
})

test("push delivery batch records delivered, retry, and expired outcomes", async () => {
  const { runPushDeliveryBatch } = await import("../lib/notifications/push-delivery-worker.ts")
  const recorded = []
  const deliveries = deliveryIds.map((deliveryId, index) => ({
    attempt: 1,
    auth: "A".repeat(24),
    body: "예약 상태가 변경되었습니다.",
    claimToken: `7a300000-0000-4000-8000-00000000000${index + 1}`,
    data: { reservationId: notificationId },
    deliveryId,
    endpoint: `https://push.example.test/subscriptions/device-${index + 1}`,
    notificationId,
    p256dh: "B".repeat(87),
    title: "SPOLINK 알림",
    type: "reservation_confirmed",
  }))

  const result = await runPushDeliveryBatch(10, {
    claim: async () => deliveries,
    record: async (deliveryId, claimToken, outcome) => {
      recorded.push({ claimToken, deliveryId, outcome })
    },
    send: async (delivery) => {
      if (delivery.deliveryId === deliveryIds[0]) return { status: "delivered" }
      if (delivery.deliveryId === deliveryIds[1]) {
        return { errorCode: "PUSH_RATE_LIMITED", status: "retry" }
      }
      return { errorCode: "PUSH_SUBSCRIPTION_EXPIRED", status: "expired" }
    },
  })

  assert.deepEqual(result, { claimed: 3, delivered: 1, expired: 1, failed: 0, retry: 1 })
  assert.deepEqual(
    recorded.map(({ deliveryId, outcome }) => ({ deliveryId, outcome })),
    [
      { deliveryId: deliveryIds[0], outcome: { status: "delivered" } },
      {
        deliveryId: deliveryIds[1],
        outcome: { errorCode: "PUSH_RATE_LIMITED", status: "retry" },
      },
      {
        deliveryId: deliveryIds[2],
        outcome: { errorCode: "PUSH_SUBSCRIPTION_EXPIRED", status: "expired" },
      },
    ],
  )
})

test("web push failures distinguish expired, retryable, and permanent responses", async () => {
  const { classifyWebPushFailure } = await import("../lib/notifications/push-provider.ts")
  assert.deepEqual(classifyWebPushFailure({ statusCode: 410 }), {
    errorCode: "PUSH_SUBSCRIPTION_EXPIRED",
    status: "expired",
  })
  assert.deepEqual(classifyWebPushFailure({ statusCode: 429 }), {
    errorCode: "PUSH_RATE_LIMITED",
    status: "retry",
  })
  assert.deepEqual(classifyWebPushFailure({ statusCode: 401 }), {
    errorCode: "PUSH_PROVIDER_REJECTED",
    status: "failed",
  })
  assert.deepEqual(classifyWebPushFailure({ code: "ECONNRESET" }), {
    errorCode: "PUSH_NETWORK_ERROR",
    status: "retry",
  })
  assert.deepEqual(classifyWebPushFailure(new Error("invalid local subscription")), {
    errorCode: "PUSH_SUBSCRIPTION_INVALID",
    status: "failed",
  })
})

test("realtime payload parser accepts owner-visible notification fields only", async () => {
  const { parseRealtimeNotification, readReplicationReadiness } = await import(
    "../lib/notifications/realtime.ts"
  )
  const parsed = parseRealtimeNotification({
    body: "예약이 확정되었습니다.",
    created_at: "2026-08-31T03:00:00.000Z",
    data: { reservationId: notificationId },
    event_key: "internal:event:key",
    id: notificationId,
    read_at: null,
    title: "예약 확정",
    type: "reservation_confirmed",
    user_id: profileId,
  })

  assert.deepEqual(parsed, {
    body: "예약이 확정되었습니다.",
    createdAt: "2026-08-31T03:00:00.000Z",
    data: { reservationId: notificationId },
    id: notificationId,
    readAt: null,
    title: "예약 확정",
    type: "reservation_confirmed",
  })
  assert.equal(parseRealtimeNotification({ id: notificationId, title: "broken" }), null)
  assert.equal(readReplicationReadiness({ extension: "postgres_changes", status: "ok" }), "ready")
  assert.equal(
    readReplicationReadiness({ extension: "postgres_changes", status: "error" }),
    "error",
  )
})

test("push migration defines private subscriptions, outbox leases, and realtime publication", async () => {
  const migration = await readFile(
    "supabase/migrations/20260831120000_add_realtime_web_push.sql",
    "utf8",
  )
  assert.match(migration, /create table public\.push_subscriptions/u)
  assert.match(migration, /create table public\.notification_push_deliveries/u)
  assert.match(migration, /alter table public\.push_subscriptions enable row level security/u)
  assert.match(migration, /create policy "push_subscriptions_owner"/u)
  assert.match(migration, /create or replace function public\.claim_notification_push_deliveries/u)
  assert.match(migration, /for update(?: of delivery)? skip locked/u)
  assert.match(migration, /current_user not in \('postgres', 'service_role'\)/u)
  assert.match(migration, /pg_publication_tables/u)
  assert.match(migration, /alter publication supabase_realtime add table public\.notifications/u)
  assert.doesNotMatch(migration, /grant .*notification_push_deliveries.*authenticated/u)
})
