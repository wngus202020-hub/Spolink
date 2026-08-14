#!/usr/bin/env node
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

import { createClient } from "@supabase/supabase-js"

import { COACH_CERTIFICATE_BUCKET } from "../../lib/storage/coach-certification.ts"
import { provisionWithAuthReadiness } from "../supabase-e2e/auth-rls/runtime.mjs"
import { fixtureUsers } from "../supabase-e2e/fixtures.mjs"

const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

async function main() {
  const provision = await provisionWithAuthReadiness()
  const learnerEmail = fixtureUsers.find((user) => user.key === "learner")?.email
  assert.ok(learnerEmail)
  const coachProfileId = randomUUID()
  const objectName = `${provision.authIds.learner}/${randomUUID()}.png`

  try {
    await prepareApplication(provision, coachProfileId, objectName)
    const clients = [
      createApplicantClient(provision.status),
      createApplicantClient(provision.status),
    ]
    await Promise.all(
      clients.map(async (client) => {
        const { error } = await client.auth.signInWithPassword({
          email: learnerEmail,
          password: provision.runPassword,
        })
        assert.ifError(error)
      }),
    )

    const directProfileStatusMutation = await clients[0]
      .from("profiles")
      .update({ status: "pending_coach" })
      .eq("id", provision.authIds.learner)
    assert.equal(directProfileStatusMutation.error?.code, "42501")

    const directMutationState = await provision.clients.serviceClient
      .from("profiles")
      .select("status,coach_profiles!coach_profiles_user_id_fkey(status)")
      .eq("id", provision.authIds.learner)
      .single()
    assert.ifError(directMutationState.error)
    assert.equal(directMutationState.data.status, "active")
    assert.equal(directMutationState.data.coach_profiles?.status, "draft")

    const ordinaryProfileMutation = await clients[0]
      .from("profiles")
      .update({ display_name: "fixture-ordinary-edit" })
      .eq("id", provision.authIds.learner)
      .select("display_name")
      .single()
    assert.ifError(ordinaryProfileMutation.error)
    assert.equal(ordinaryProfileMutation.data.display_name, "fixture-ordinary-edit")

    const attempts = await Promise.all(
      clients.map((client) => client.rpc("submit_coach_application")),
    )
    const successes = attempts.filter((attempt) => !attempt.error)
    const conflicts = attempts.filter(
      (attempt) =>
        attempt.error?.code === "P0001" && attempt.error.message === "COACH_APPLICATION_CONFLICT",
    )
    assert.equal(successes.length, 1)
    assert.equal(conflicts.length, 1)

    const { data: state, error: stateError } = await provision.clients.serviceClient
      .from("profiles")
      .select("role,status,coach_profiles!coach_profiles_user_id_fkey(status,submitted_at)")
      .eq("id", provision.authIds.learner)
      .single()
    assert.ifError(stateError)
    assert.equal(state.role, "learner")
    assert.equal(state.status, "pending_coach")
    assert.equal(state.coach_profiles?.status, "submitted")
    assert.ok(state.coach_profiles?.submitted_at)

    const directMutation = await clients[0]
      .from("coach_profiles")
      .update({ status: "approved" })
      .eq("id", coachProfileId)
    assert.equal(directMutation.error?.code, "42501")

    console.log(
      JSON.stringify({
        concurrentSubmit: { conflicts: conflicts.length, successes: successes.length },
        directCoachStatusMutation: "rejected",
        directProfileStatusMutation: "rejected-with-paired-state-unchanged",
        ordinaryProfileMutation: "allowed",
        finalTuple: {
          coachStatus: state.coach_profiles.status,
          profileRole: state.role,
          profileStatus: state.status,
        },
        objectMetadataInvariant: "verified-before-submit",
      }),
    )
  } finally {
    await provision.clients.serviceClient.storage
      .from(COACH_CERTIFICATE_BUCKET)
      .remove([objectName])
    await provision.clients.serviceClient.from("coach_profiles").delete().eq("id", coachProfileId)
    await provision.cleanup()
  }
}

function createApplicantClient(status) {
  return createClient(status.apiUrl, status.anonKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  })
}

async function prepareApplication(provision, coachProfileId, objectName) {
  const { error: profileError } = await provision.clients.serviceClient
    .from("profiles")
    .update({
      avatar_path: `profiles/${provision.authIds.learner}/avatar.png`,
      phone: "010-0000-0000",
      real_name: "Task4 Applicant",
      role: "learner",
      status: "active",
    })
    .eq("id", provision.authIds.learner)
  assert.ifError(profileError)

  const { error: coachError } = await provision.clients.serviceClient
    .from("coach_profiles")
    .insert({
      bank_account_last4: "1234",
      bank_name: "SPOLINK Bank",
      bio: "Task4 concurrent submission biography",
      career_years: 4,
      headline: "Task4 Coach",
      id: coachProfileId,
      payout_holder_name: "Task4 Applicant",
      primary_sport_id: provision.rows.coachProfiles[0].primary_sport_id,
      service_region: "서울 강남구",
      status: "draft",
      user_id: provision.authIds.learner,
    })
  assert.ifError(coachError)

  const { error: objectError } = await provision.clients.serviceClient.storage
    .from(COACH_CERTIFICATE_BUCKET)
    .upload(objectName, new Blob([pngBytes], { type: "image/png" }), {
      contentType: "image/png",
      upsert: false,
    })
  assert.ifError(objectError)

  const { error: certificateError } = await provision.clients.serviceClient
    .from("coach_certificates")
    .insert({
      certificate_name: "Task4 Certificate",
      coach_profile_id: coachProfileId,
      file_path: objectName,
    })
  assert.ifError(certificateError)
}

await main()
