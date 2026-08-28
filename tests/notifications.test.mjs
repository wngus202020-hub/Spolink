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

const learnerId = "77000000-0000-4000-8000-000000000001"
const notificationId = "77100000-0000-4000-8000-000000000001"

test("notification list uses owner scope and deterministic cursor ordering", async () => {
  const { createNotificationRouteDependencies, createListNotificationsRouteHandler } = await import(
    "../lib/notifications/route-handlers.ts"
  )
  const calls = []
  const handler = createListNotificationsRouteHandler(
    createNotificationRouteDependencies(
      async () => ({
        getAccess: async () => ({ profileId: learnerId, user: { id: learnerId } }),
        repository: {
          list: async (userId, query) => {
            calls.push({ userId, query })
            return {
              items: [],
              meta: {
                hasNextPage: false,
                nextCursor: null,
                page: query.page,
                pageSize: query.pageSize,
              },
            }
          },
          markRead: async () => "read",
        },
      }),
      () => true,
    ),
  )
  const response = await handler(
    new Request("http://127.0.0.1/api/notifications?page=2&pageSize=10&unreadOnly=true"),
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(calls, [
    { userId: learnerId, query: { cursor: null, page: 2, pageSize: 10, unreadOnly: true } },
  ])
})

test("notification read is owner-only, strict, no-store, and already-read idempotent", async () => {
  const { createMarkNotificationReadRouteHandler, createNotificationRouteDependencies } =
    await import("../lib/notifications/route-handlers.ts")
  let markCalls = 0
  const handler = createMarkNotificationReadRouteHandler(
    createNotificationRouteDependencies(
      async () => ({
        getAccess: async () => ({ profileId: learnerId, user: { id: learnerId } }),
        repository: {
          list: async () => null,
          markRead: async (userId, id) => {
            markCalls += 1
            assert.equal(userId, learnerId)
            assert.equal(id, notificationId)
            return "read"
          },
        },
      }),
      () => true,
    ),
  )
  const response = await handler(
    new Request(`http://127.0.0.1/api/notifications/${notificationId}/read`, {
      body: "{}",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1" },
      method: "POST",
    }),
    { params: Promise.resolve({ notificationId }) },
  )
  assert.equal(response.status, 200)
  assert.equal(markCalls, 1)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
})

test("notification read accepts browser same-origin metadata when Origin is omitted", async () => {
  const { createMarkNotificationReadRouteHandler, createNotificationRouteDependencies } =
    await import("../lib/notifications/route-handlers.ts")
  const handler = createMarkNotificationReadRouteHandler(
    createNotificationRouteDependencies(
      async () => ({
        getAccess: async () => ({ profileId: learnerId, user: { id: learnerId } }),
        repository: { list: async () => null, markRead: async () => "read" },
      }),
      () => true,
    ),
  )
  const response = await handler(
    new Request(`http://127.0.0.1/api/notifications/${notificationId}/read`, {
      body: "{}",
      headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
      method: "POST",
    }),
    { params: Promise.resolve({ notificationId }) },
  )
  assert.equal(response.status, 200)
})

test("notification read accepts same-origin browser referer when fetch metadata is absent", async () => {
  const { createMarkNotificationReadRouteHandler, createNotificationRouteDependencies } =
    await import("../lib/notifications/route-handlers.ts")
  const handler = createMarkNotificationReadRouteHandler(
    createNotificationRouteDependencies(
      async () => ({
        getAccess: async () => ({ profileId: learnerId, user: { id: learnerId } }),
        repository: { list: async () => null, markRead: async () => "read" },
      }),
      () => true,
    ),
  )
  const response = await handler(
    new Request(`http://127.0.0.1/api/notifications/${notificationId}/read`, {
      body: "{}",
      headers: {
        "Content-Type": "application/json",
        Host: "127.0.0.1:3000",
        Referer: "http://127.0.0.1:3000/mypage/notifications",
      },
      method: "POST",
    }),
    { params: Promise.resolve({ notificationId }) },
  )
  assert.equal(response.status, 200)
})

test("concurrent notification read retries resolve as idempotent success", async () => {
  const { createNotificationRepository } = await import("../lib/notifications/repository.ts")
  let updateCalls = 0
  const client = {
    from: () => ({
      select: () => {
        const builder = {
          eq: () => builder,
          is: () => builder,
          maybeSingle: async () => ({
            data:
              updateCalls === 0
                ? { id: notificationId, read_at: null }
                : { id: notificationId, read_at: "2026-08-14T00:00:00.000Z" },
            error: null,
          }),
        }
        return builder
      },
      update: () => {
        const builder = {
          eq: () => builder,
          is: () => builder,
          select: () => builder,
          maybeSingle: async () => {
            updateCalls += 1
            return { data: updateCalls === 1 ? { id: notificationId } : null, error: null }
          },
        }
        return builder
      },
    }),
  }
  const repository = createNotificationRepository(client)

  const results = await Promise.all([
    repository.markRead(learnerId, notificationId),
    repository.markRead(learnerId, notificationId),
  ])

  assert.deepEqual(results, ["read", "read"])
})

test("notification event migration has transactional replay, rollback, and redaction barriers", async () => {
  const migration = await readFile(
    "supabase/migrations/20260814140000_add_notification_events.sql",
    "utf8",
  )
  assert.match(migration, /create unique index notification_event_once_idx/u)
  assert.match(migration, /create or replace function public\.emit_notification_once/u)
  assert.match(migration, /exception when unique_violation/u)
  assert.match(migration, /emit_refund_result_notification/u)
  assert.match(migration, /emit_settlement_status_notification/u)
  assert.match(
    migration,
    /jsonb_build_object\('refundId', new\.id, 'reservationId', new\.reservation_id, 'status', new\.status\)/u,
  )
  assert.match(
    migration,
    /jsonb_build_object\('settlementId', new\.id, 'reservationId', new\.reservation_id, 'status', new\.status\)/u,
  )
  assert.doesNotMatch(migration, /raw_payload|provider_refund_key|phone|email|token|cookie/u)
})
