import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const originalMigration = await readFile(
  "supabase/migrations/20260814120000_add_reservation_lifecycle.sql",
  "utf8",
)
const effectiveLifecycleMigration = await readFile(
  "supabase/migrations/20260818120000_use_statement_time_for_reservation_lifecycle.sql",
  "utf8",
)
const workflow = await readFile("lib/reservations/reservation-lifecycle-api.ts", "utf8")
const adapter = await readFile("lib/reservations/reservation-lifecycle-route-adapter.ts", "utf8")

test("lifecycle uses a separate RPC and preserves the six-column cancellation boundary", () => {
  assert.match(
    originalMigration,
    /create or replace function public\.transition_reservation_lifecycle\(/u,
  )
  assert.match(originalMigration, /create or replace function public\.transition_reservation\(/u)
  assert.match(
    originalMigration,
    /from public\.cancel_reservation\(checked_reservation_id, checked_reason\)/u,
  )
  assert.match(workflow, /transition_reservation_lifecycle/u)
})

test("lifecycle transition derives status, actor, time, refund and settlement in SQL", () => {
  assert.match(effectiveLifecycleMigration, /for update;/gu)
  assert.match(
    effectiveLifecycleMigration,
    /transition_instant timestamptz := statement_timestamp\(\)/u,
  )
  assert.doesNotMatch(effectiveLifecycleMigration, /transaction_timestamp\(\)/u)
  assert.match(
    effectiveLifecycleMigration,
    /transition_instant < public\.reservation_no_show_available_at\(selected_schedule\.starts_at\)/u,
  )
  assert.match(effectiveLifecycleMigration, /selected_coach\.status = 'approved'/u)
  assert.match(effectiveLifecycleMigration, /acting_profile\.role <> 'admin'/u)
  assert.match(effectiveLifecycleMigration, /insert into public\.settlements/u)
  assert.match(effectiveLifecycleMigration, /insert into public\.refunds/u)
  assert.match(effectiveLifecycleMigration, /insert into public\.audit_logs/u)
  assert.match(effectiveLifecycleMigration, /insert into public\.notifications/u)
  assert.doesNotMatch(
    effectiveLifecycleMigration,
    /checked_status|checked_completed_at|checked_no_show_marked_at/u,
  )
})

test("completion and no-show bodies are strict commands with no client final state", () => {
  assert.match(workflow, /completeBodySchema = z\.object\(\{\}\)\.strict\(\)/u)
  assert.match(workflow, /noShowBodySchema = z[\s\S]*\.strict\(\)/u)
  assert.match(workflow, /action: z\.enum\(\["mark_learner_no_show", "mark_coach_no_show"\]\)/u)
  assert.doesNotMatch(workflow, /\bstatus:\s*z\.|\bcompletedAt:\s*z\.|\bnoShowMarkedAt:\s*z\./u)
})

test("HTTP mutation boundary rejects non same-origin, non-JSON and malformed requests", () => {
  assert.match(adapter, /Same-origin request required\./u)
  assert.match(adapter, /Content-Type must be application\/json\./u)
  assert.match(adapter, /Request body must be valid JSON\./u)
  assert.match(adapter, /Cache-Control.*private, no-store/u)
})

test("lifecycle side effects have database replay barriers and rollback as one transaction", () => {
  assert.match(originalMigration, /reservation_lifecycle_audit_once_idx/u)
  assert.match(originalMigration, /reservation_lifecycle_notification_once_idx/u)
  assert.match(originalMigration, /reservation_coach_no_show_refund_once_idx/u)
  assert.match(effectiveLifecycleMigration, /security definer/u)
  assert.match(
    effectiveLifecycleMigration,
    /where id = selected_reservation\.id\n {4}returning \* into selected_reservation/u,
  )
})

test("lifecycle replay compares the normalized reason and conflicts on a changed reason", () => {
  assert.match(
    effectiveLifecycleMigration,
    /existing_audit\.after_data ->> 'reason'\) is not distinct from trimmed_reason/u,
  )
  assert.match(
    effectiveLifecycleMigration,
    /Reservation lifecycle conflicts with the original request\.[\s\S]*errcode = '23505'/u,
  )
})
