# Notifications Domain Guide

Notifications expose private, owner-scoped in-app alerts, Realtime updates, read-state mutations,
and opt-in Web Push delivery; delivery and audit side effects remain trusted SQL concerns.

## WHERE TO LOOK

- `route-handlers.ts`: query parsing, UUID path validation, same-origin and response mapping.
- `workflow.ts`: authenticated/restricted access decisions and repository result states.
- `repository.ts`: Supabase reads, unread filtering, cursor pagination, and idempotent read writes.
- `types.ts`: `NotificationItem`, `NotificationPage`, query bounds, and cursor encoding.
- `default-dependencies.ts`: cookie-aware server client, claims/profile access, repository wiring.
- `app/api/notifications/route.ts`: `GET /api/notifications` adapter.
- `app/api/notifications/[notificationId]/read/route.ts`: `POST` read-state adapter.
- `tests/notifications.test.mjs`: route, ownership, no-store, UUID, and concurrent-read contracts.
- `supabase/migrations/20260712000000_mvp_schema.sql`: table, indexes, RLS, and read-update trigger.
- `supabase/migrations/20260814140000_add_notification_events.sql`: event keys, exactly-once RPC,
  refund/settlement delivery triggers, and restricted function grants.
- `supabase/migrations/20260831120000_add_realtime_web_push.sql`: Realtime publication, private push
  subscriptions, transactional outbox, service-role leases, retries, and terminal cleanup.
- `push-subscription-*`: same-origin owner subscription API and authenticated RPC adapter.
- `push-delivery-*`: trusted worker route, service-role claim/result adapter, and Web Push provider.
- `realtime.ts`, `realtime-client.ts`: safe payload parsing, replication readiness, and catch-up reads.
- `public/spolink-sw.js`: deployed Web Push service worker for `push` and `notificationclick` events.
- `app/api/notifications/push-subscriptions/route.ts`: owner subscription POST/DELETE entry point;
  `app/api/notifications/push/deliver/route.ts`: trusted delivery worker entry point.

## CONVENTIONS

- Every list/read operation carries the authenticated `profileId` into the repository; never trust
  a recipient ID from query parameters or request JSON.
- `GET` accepts `page`, bounded `pageSize`, opaque cursor, and `unreadOnly=true|false`; unread means
  `read_at IS NULL`, with `(created_at DESC, id DESC)` as the stable ordering.
- Read mutation is `POST /api/notifications/:notificationId/read` with an empty JSON object only;
  the path value must be a UUID and the repository updates only an unread row owned by that user.
- Already-read concurrent retries resolve as success; missing owned rows map to `NOT_FOUND`.
- Keep route, workflow, repository, and types responsibilities separate. Routes parse/authorize HTTP,
  workflows classify domain access/results, repositories persist, and types shape browser-safe output.
- All notification API responses are `private, no-store`; preserve refreshed auth cookies in headers.
- Delivery payloads are small typed data values. Event keys and deduplication belong to trusted RPC/SQL,
  not browser clients or ordinary notification repository methods.
- Realtime must await auth and `replication_ready`; only show connected after an owner-scoped catch-up
  read closes the SSR-to-subscription gap.
- Push permission is requested only after a user action. VAPID private keys and subscription secrets
  never enter page props, responses, logs, screenshots, or evidence.
- Delivery claims use `FOR UPDATE SKIP LOCKED`, bounded leases, five attempts, exponential backoff,
  and service-role-only result RPCs. HTTP 400/404/410 expires a subscription; retry only transient
  network, rate-limit, timeout, and provider 5xx failures.

## ANTI-PATTERNS

- Do not list by a client-authored `user_id`, expose another user's notification, or weaken RLS with a
  service client for ordinary member reads.
- Do not accept `read_at`, notification type/title/body/data, delivery status, event key, audit actor,
  audit timestamp, or audit result from client input.
- Do not perform push delivery or audit insertion in the browser or ordinary read mutation;
  transactional producers enqueue effects and the trusted worker owns provider delivery.
- Do not add cacheable responses, non-UUID notification identifiers, offset-only pagination, or a
  second read-state endpoint without updating the contracts and live SQL assertions.

## VERIFY

- Focused Node contracts: `tests/notifications.test.mjs` and `tests/notification-push.test.mjs` via
  `corepack pnpm test:api:contracts`.
- Full API contract/runtime suite: `corepack pnpm test:api`.
- Static gates: `corepack pnpm typecheck` and `corepack pnpm lint`.
- Focused SQL/RLS: `supabase/tests/notifications.test.sql` and `supabase/tests/notification_push.test.sql` via
  `corepack pnpm supabase:test:db`.
- Browser Realtime/push: `tests/auth-ui-e2e/notification-push.spec.ts` via `corepack pnpm test:e2e:notifications`.
- Live coupling: `corepack pnpm test:e2e:supabase`; inspect notification and audit counts in
  `tests/supabase-e2e/cancellation-concurrency.test.mjs` and
  `tests/supabase-e2e/reservation-lifecycle/live-helpers.mjs`.
- Any schema or producer change requires the focused contract plus the relevant live SQL scenario;
  do not treat route mocks alone as evidence of delivery or audit correctness.
- Hosted worker scheduling and live external Push Service delivery remain pending.
