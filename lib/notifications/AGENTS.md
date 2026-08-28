# Notifications Domain Guide

Notifications expose private, owner-scoped in-app alerts and a read-state mutation;
delivery and audit side effects remain trusted SQL concerns.

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

## ANTI-PATTERNS

- Do not list by a client-authored `user_id`, expose another user's notification, or weaken RLS with a
  service client for ordinary member reads.
- Do not accept `read_at`, notification type/title/body/data, delivery status, event key, audit actor,
  audit timestamp, or audit result from client input.
- Do not perform notification delivery or audit insertion in the browser, route adapter, or read
  mutation; transactional producers own those effects in SQL/RPC triggers.
- Do not add cacheable responses, non-UUID notification identifiers, offset-only pagination, or a
  second read-state endpoint without updating the contracts and live SQL assertions.

## VERIFY

- Focused contract: `corepack pnpm test:api:contracts` (includes `tests/notifications.test.mjs`).
- Full API contract/runtime suite: `corepack pnpm test:api`.
- Static gates: `corepack pnpm typecheck` and `corepack pnpm lint`.
- SQL/RLS migration validation: `corepack pnpm supabase:test:db`.
- Live coupling: `corepack pnpm test:e2e:supabase`; inspect notification and audit counts in
  `tests/supabase-e2e/cancellation-concurrency.test.mjs` and
  `tests/supabase-e2e/reservation-lifecycle/live-helpers.mjs`.
- Any schema or producer change requires the focused contract plus the relevant live SQL scenario;
  do not treat route mocks alone as evidence of delivery or audit correctness.
