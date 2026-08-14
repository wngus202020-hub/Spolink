import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import test from "node:test"

import "../profile-api/fixtures.mjs"

const submittedProfileId = "10000000-0000-4000-8000-000000000001"

test("Given admin list query input, when parsed, then status and bounded pagination are explicit", async () => {
  const contract = await import("../../lib/coach-certification/contract.ts")

  assert.equal(typeof contract.parseAdminCoachListQuery, "function")
  assert.deepEqual(
    contract.parseAdminCoachListQuery(
      new URLSearchParams({ page: "2", pageSize: "50", status: "submitted" }),
    ),
    { page: 2, pageSize: 50, status: "submitted" },
  )
  assert.equal(
    contract.parseAdminCoachListQuery(
      new URLSearchParams({ page: "0", pageSize: "101", status: "unknown" }),
    ),
    null,
  )
})

test("Given approve and reject requests, when handled, then only valid same-origin decisions run", async () => {
  const routes = await import("../../lib/coach-certification/admin-route-handlers.ts")
  const calls = []
  const dependencies = {
    createWorkflowDependencies: async () => ({
      getVerifiedAdmin: async () => ({
        kind: "admin",
        user: { id: "20000000-0000-4000-8000-000000000001" },
      }),
      reviewApplication: async (profileId, decision, reason) => {
        calls.push({ decision, profileId, reason })
        return {
          errorCode: null,
          data: {
            coachProfileId: profileId,
            coachStatus: decision === "approve" ? "approved" : "rejected",
            idempotent: false,
            profileStatus: decision === "approve" ? "coach_approved" : "active",
            reviewedAt: "2026-08-13T00:00:00.000Z",
          },
        }
      },
    }),
    isSupabaseConfigured: () => true,
  }
  const context = { params: Promise.resolve({ coachProfileId: submittedProfileId }) }
  const approve = routes.createApproveCoachProfileRouteHandler(dependencies)
  const reject = routes.createRejectCoachProfileRouteHandler(dependencies)

  const approved = await approve(jsonRequest("approve", {}), context)
  const rejected = await reject(
    jsonRequest("reject", { rejectionReason: "서류가 흐립니다." }),
    context,
  )
  const malformed = await reject(jsonRequest("reject", { rejectionReason: "   " }), context)
  const oversized = await reject(
    jsonRequest("reject", { rejectionReason: "가".repeat(1001) }),
    context,
  )
  const clientAuthority = await approve(jsonRequest("approve", { status: "approved" }), context)

  assert.deepEqual(
    [approved.status, rejected.status, malformed.status, oversized.status, clientAuthority.status],
    [200, 200, 422, 422, 422],
  )
  assert.equal(approved.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(calls, [
    { decision: "approve", profileId: submittedProfileId, reason: null },
    {
      decision: "reject",
      profileId: submittedProfileId,
      reason: "서류가 흐립니다.",
    },
  ])
})

test("Given the admin review migration, when inspected, then locking and exactly-once side effects are atomic", async () => {
  const migrationNames = await readdir("supabase/migrations")
  const migrationName = migrationNames.find((name) =>
    name.endsWith("_review_coach_application.sql"),
  )

  assert.ok(migrationName, "Todo 5 review migration must exist")
  const migration = await readFile(`supabase/migrations/${migrationName}`, "utf8")

  assert.match(migration, /security definer/u)
  assert.match(migration, /acting_admin\.role <> 'admin'/u)
  assert.match(migration, /acting_admin\.status <> 'active'/u)
  assert.match(migration, /acting_admin\.deleted_at is not null/u)
  assert.match(migration, /from public\.coach_profiles[\s\S]*for update/u)
  assert.match(migration, /from public\.profiles[\s\S]*for update/u)
  assert.match(migration, /insert into public\.audit_logs/u)
  assert.match(migration, /insert into public\.notifications/u)
  assert.match(
    migration,
    /create policy "coach_certificate_objects_admin_select"[\s\S]*bucket_id = 'coach-certificates'[\s\S]*public\.is_admin\(\)/u,
  )
  const restrictionMigrationName = migrationNames.find((name) =>
    name.endsWith("_restrict_admin_certificate_direct_access.sql"),
  )
  assert.ok(restrictionMigrationName, "direct admin Storage access restriction must exist")
  const restrictionMigration = await readFile(
    `supabase/migrations/${restrictionMigrationName}`,
    "utf8",
  )
  assert.match(
    restrictionMigration,
    /drop policy if exists "coach_certificate_objects_admin_select" on storage\.objects/u,
  )
  const defaultDependencies = await readFile(
    "lib/coach-certification/admin-default-dependencies.ts",
    "utf8",
  )
  assert.match(defaultDependencies, /createSupabaseServiceClient/u)
  assert.match(migration, /grant execute[\s\S]*to authenticated/u)
  assert.doesNotMatch(migration, /grant execute[\s\S]*to anon/u)
})

function jsonRequest(decision, body) {
  return new Request(
    `http://localhost/api/admin/coach-profiles/${submittedProfileId}/${decision}`,
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", origin: "http://localhost" },
      method: "POST",
    },
  )
}
