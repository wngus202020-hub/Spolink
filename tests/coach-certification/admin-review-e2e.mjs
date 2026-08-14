#!/usr/bin/env node
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

import { createClient } from "@supabase/supabase-js"
import postgres from "postgres"

import { createPersonaClients, signInPersonas } from "../supabase-e2e/auth-rls/clients.mjs"
import { provisionWithAuthReadiness } from "../supabase-e2e/auth-rls/runtime.mjs"
import { fixedIds } from "../supabase-e2e/fixtures.mjs"

const concurrentCoachProfileId = randomUUID()

async function main() {
  const provision = await provisionWithAuthReadiness()
  const personas = createPersonaClients(provision.status)
  try {
    await signInPersonas(personas, provision.runPassword)
    await prepareTargets(provision)

    for (const key of ["learner", "coach", "pendingCoach"]) {
      const attempt = await personas[key].rpc("review_coach_application", {
        checked_coach_profile_id: concurrentCoachProfileId,
        checked_decision: "approve",
        checked_rejection_reason: null,
      })
      assert.equal(attempt.error?.message, "FORBIDDEN")
    }
    const anonymous = await personas.anonymous.rpc("review_coach_application", {
      checked_coach_profile_id: concurrentCoachProfileId,
      checked_decision: "approve",
      checked_rejection_reason: null,
    })
    assert.equal(anonymous.error?.code, "42501")

    const secondAdmin = browserClient(provision.status)
    const adminEmail = "admin@spolink.test"
    const signIn = await secondAdmin.auth.signInWithPassword({
      email: adminEmail,
      password: provision.runPassword,
    })
    assert.ifError(signIn.error)
    const concurrent = await Promise.all([
      personas.admin.rpc("review_coach_application", {
        checked_coach_profile_id: concurrentCoachProfileId,
        checked_decision: "approve",
        checked_rejection_reason: null,
      }),
      secondAdmin.rpc("review_coach_application", {
        checked_coach_profile_id: concurrentCoachProfileId,
        checked_decision: "reject",
        checked_rejection_reason: "동시 심사 반려",
      }),
    ])
    const winner = concurrent.find((result) => !result.error)
    const loser = concurrent.find((result) => result.error)
    assert.ok(winner?.data?.[0])
    assert.equal(loser?.error?.message, "COACH_APPLICATION_CONFLICT")

    const winningDecision = winner.data[0].coach_status === "approved" ? "approve" : "reject"
    const sameDecision = await personas.admin.rpc("review_coach_application", {
      checked_coach_profile_id: concurrentCoachProfileId,
      checked_decision: winningDecision,
      checked_rejection_reason: winningDecision === "reject" ? "재시도 사유" : null,
    })
    assert.ifError(sameDecision.error)
    assert.equal(sameDecision.data[0].idempotent, true)

    const rejectFirstCycle = await personas.admin.rpc("review_coach_application", {
      checked_coach_profile_id: fixedIds.pendingCoachProfile,
      checked_decision: "reject",
      checked_rejection_reason: "재제출 회차 검증",
    })
    assert.ifError(rejectFirstCycle.error)
    assert.equal(rejectFirstCycle.data[0].coach_status, "rejected")
    await resubmitFixedTarget(provision)

    const approve = await personas.admin.rpc("review_coach_application", {
      checked_coach_profile_id: fixedIds.pendingCoachProfile,
      checked_decision: "approve",
      checked_rejection_reason: null,
    })
    assert.ifError(approve.error)
    assert.equal(approve.data[0].coach_status, "approved")

    const [sideEffects, publicCard, applicantProfile, applicantNotification] = await Promise.all([
      provision.clients.serviceClient
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("target_id", concurrentCoachProfileId),
      provision.clients.anonClient
        .from("coach_profile_public_cards")
        .select("id")
        .eq("id", fixedIds.pendingCoachProfile)
        .maybeSingle(),
      provision.clients.serviceClient
        .from("profiles")
        .select("status")
        .eq("id", provision.authIds.pendingCoach)
        .single(),
      provision.clients.serviceClient
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", provision.authIds.pendingCoach)
        .eq("type", "coach_certification.reviewed"),
    ])
    assert.equal(sideEffects.count, 1)
    assert.ifError(publicCard.error)
    assert.equal(publicCard.data?.id, fixedIds.pendingCoachProfile)
    assert.equal(applicantProfile.data?.status, "coach_approved")
    assert.equal(applicantNotification.count, 2)

    console.log(
      JSON.stringify({
        applicantNotification: "exactly-one-per-submission-cycle",
        applicantStatus: "coach_approved",
        concurrentReview: { conflicts: 1, winners: 1 },
        nonAdminPersonas: "forbidden",
        publicEligibility: "visible",
        resubmittedReview: "rejected-then-approved",
        sameDecision: "idempotent",
      }),
    )
  } finally {
    await cleanupTargets(provision)
    await provision.cleanup()
  }
}

async function resubmitFixedTarget(provision) {
  const sql = postgres(provision.status.dbUrl, { max: 1 })
  try {
    await sql.begin(async (transaction) => {
      await transaction`set local session_replication_role = replica`
      await transaction`
        update public.coach_profiles
        set
          status = 'submitted',
          submitted_at = submitted_at + interval '1 second',
          reviewed_at = null,
          reviewed_by = null,
          rejection_reason = null
        where id = ${fixedIds.pendingCoachProfile}
      `
      await transaction`
        update public.profiles set status = 'pending_coach'
        where id = ${provision.authIds.pendingCoach}
      `
    })
  } finally {
    await sql.end({ timeout: 1 })
  }
}

async function prepareTargets(provision) {
  const sql = postgres(provision.status.dbUrl, { max: 1 })
  try {
    await sql.begin(async (transaction) => {
      await transaction`set local session_replication_role = replica`
      await transaction`
        update public.profiles
        set role = 'learner', status = 'pending_coach'
        where id in (${provision.authIds.learner}, ${provision.authIds.pendingCoach})
      `
      await transaction`
        insert into public.coach_profiles (
          id, service_region, status, submitted_at, user_id
        ) values (
          ${concurrentCoachProfileId}, '서울 강남구', 'submitted', now(),
          ${provision.authIds.learner}
        )
      `
    })
  } finally {
    await sql.end({ timeout: 1 })
  }
}

async function cleanupTargets(provision) {
  const sql = postgres(provision.status.dbUrl, { max: 1 })
  try {
    await sql.begin(async (transaction) => {
      await transaction`set local session_replication_role = replica`
      await transaction`
        delete from public.notifications
        where type = 'coach_certification.reviewed'
          and user_id in (${provision.authIds.learner}, ${provision.authIds.pendingCoach})
      `
      await transaction`
        delete from public.audit_logs
        where target_id in (${concurrentCoachProfileId}, ${fixedIds.pendingCoachProfile})
          and action in ('coach_certification.approved', 'coach_certification.rejected')
      `
      await transaction`delete from public.coach_profiles where id = ${concurrentCoachProfileId}`
      await transaction`
        update public.profiles set role = 'learner', status = 'active'
        where id = ${provision.authIds.learner}
      `
      await transaction`
        update public.coach_profiles
        set rejection_reason = null, reviewed_at = null, reviewed_by = null, status = 'submitted'
        where id = ${fixedIds.pendingCoachProfile}
      `
      await transaction`
        update public.profiles set role = 'coach', status = 'pending_coach'
        where id = ${provision.authIds.pendingCoach}
      `
    })
  } finally {
    await sql.end({ timeout: 1 })
  }
}

function browserClient(status) {
  return createClient(status.apiUrl, status.anonKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  })
}

await main()
