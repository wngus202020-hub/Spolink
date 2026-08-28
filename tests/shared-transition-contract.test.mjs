import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationPath = "supabase/migrations/20260814000000_freeze_shared_transition_contracts.sql"
const actionBoundaryMigrationPath =
  "supabase/migrations/20260814010000_add_reservation_action_boundary.sql"

test("shared action enums and workflow-only grants freeze mutation authority", async () => {
  const migration = await readFile(migrationPath, "utf8")

  assert.match(
    migration,
    /create type public\.reservation_status_action as enum \([\s\S]*'complete'[\s\S]*'mark_learner_no_show'[\s\S]*'mark_coach_no_show'[\s\S]*'open_dispute'[\s\S]*'cancel'/u,
  )
  assert.match(migration, /create type public\.report_target_type as enum/u)
  assert.doesNotMatch(
    migration.match(/create type public\.report_target_type[\s\S]*?\);/u)?.[0] ?? "",
    /'message'/u,
  )
  assert.match(
    migration,
    /revoke insert, update, delete on public\.reservations from anon, authenticated/u,
  )
  assert.match(
    migration,
    /revoke insert, update, delete on public\.reports from anon, authenticated/u,
  )
  assert.match(migration, /grant update \(read_at\) on public\.notifications to authenticated/u)
  assert.match(migration, /public\.is_approved_coach/u)
})

test("schedule, reservation, amount, and redaction checks are database-owned", async () => {
  const migration = await readFile(migrationPath, "utf8")

  assert.match(migration, /interval '15 minutes'/u)
  assert.match(migration, /statement_timestamp\(\)/u)
  assert.match(migration, /for update/u)
  assert.match(migration, /A schedule with a confirmed reservation is locked/u)
  assert.match(
    migration,
    /net_amount = gross_amount - platform_fee_amount - payment_fee_amount - refund_amount/u,
  )
  assert.match(migration, /notifications_data_allowlist_check/u)
  assert.match(migration, /checked_data - array\['reservationId'\] = '\{\}'::jsonb/u)
  assert.doesNotMatch(migration, /checked_(?:actor|reviewer|status|timestamp|amount)/u)
})

test("database types and product contracts expose the same frozen boundary", async () => {
  const [types, api, erd, policy] = await Promise.all([
    readFile("lib/supabase/database.types.ts", "utf8"),
    readFile("SPOLINK_API_명세서.md", "utf8"),
    readFile("SPOLINK_ERD.md", "utf8"),
    readFile("SPOLINK_서비스_정책서.md", "utf8"),
  ])

  assert.match(
    types,
    /type ReportTargetType = "coach" \| "lesson" \| "reservation" \| "review" \| "user"/u,
  )
  assert.doesNotMatch(types.match(/type ReportTargetType[^\n]*/u)?.[0] ?? "", /message/u)
  assert.match(types, /type ReservationStatusAction =/u)
  assert.match(types, /type NotificationType =/u)
  assert.match(api, /action은 `mark_learner_no_show \| mark_coach_no_show`만 허용/u)
  assert.match(api, /정확히 15분/u)
  assert.match(api, /`targetType`은 `user \| coach \| lesson \| review \| reservation`만 허용/u)
  assert.match(erd, /lesson_status_action \| submit, pause, resume, close, approve, reject/u)
  assert.match(erd, /provider key, token\/cookie, raw payload/u)
  assert.match(policy, /local MVP에서 실행 가능한 정산 명령은 `approve`, `hold`뿐/u)
  assert.match(policy, /채팅이 구현되지 않은 MVP에서는 메시지 신고/u)
})

test("an authorized RPC consumes cancel action without client-owned transition fields", async () => {
  const [migration, types] = await Promise.all([
    readFile(actionBoundaryMigrationPath, "utf8"),
    readFile("lib/supabase/database.types.ts", "utf8"),
  ])

  assert.match(
    migration,
    /public\.transition_reservation\([\s\S]*checked_action public\.reservation_status_action/u,
  )
  assert.match(migration, /checked_action is null or checked_action <> 'cancel'/u)
  assert.match(
    migration,
    /from public\.cancel_reservation\(checked_reservation_id, checked_reason\)/u,
  )
  assert.match(
    migration,
    /revoke all on function public\.transition_reservation\([\s\S]*from public, anon/u,
  )
  assert.match(
    migration,
    /grant execute on function public\.transition_reservation\([\s\S]*to authenticated/u,
  )
  assert.doesNotMatch(
    migration.match(/public\.transition_reservation\([\s\S]*?\)\nreturns table/u)?.[0] ?? "",
    /checked_(?:status|timestamp|amount|actor|reviewer)/u,
  )
  assert.match(types, /transition_reservation: Rpc<[\s\S]*checked_action: ReservationStatusAction/u)
})
