import assert from "node:assert/strict"
import test from "node:test"

import "../profile-api/fixtures.mjs"

test("draft persistence uses the approved RPC without owner or review fields", async () => {
  const calls = []
  const profile = { id: "profile", status: "draft", user_id: "owner" }
  const supabase = {
    rpc: async (name, args) => {
      calls.push({ args, name })
      return { data: [profile], error: null }
    },
  }
  const { createApplicantWorkflowDependencies } = await import(
    "../../lib/coach-certification/applicant-repository.ts"
  )
  const dependencies = createApplicantWorkflowDependencies(supabase)

  const result = await dependencies.updateApplication("owner", {
    bankAccountLast4: "1234",
    bankName: "SPOLINK 은행",
    bio: "안전한 입문 수업을 진행합니다.",
    careerYears: 4,
    headline: "입문 전문 지도자",
    payoutHolderName: "신청자",
    primarySportId: "00000000-0000-4000-8000-000000000003",
    serviceRegion: "서울 강남구",
  })

  assert.equal(result.profile, profile)
  assert.deepEqual(calls, [
    {
      name: "upsert_coach_application_draft",
      args: {
        checked_bank_account_last4: "1234",
        checked_bank_name: "SPOLINK 은행",
        checked_bio: "안전한 입문 수업을 진행합니다.",
        checked_career_years: 4,
        checked_headline: "입문 전문 지도자",
        checked_payout_holder_name: "신청자",
        checked_primary_sport_id: "00000000-0000-4000-8000-000000000003",
        checked_service_region: "서울 강남구",
      },
    },
  ])
})

for (const domainCode of [
  "ACCOUNT_DELETED",
  "ACCOUNT_SUSPENDED",
  "COACH_APPLICATION_CONFLICT",
  "FORBIDDEN",
  "PROFILE_REQUIRED",
  "UNAUTHORIZED",
  "VALIDATION_ERROR",
]) {
  test(`draft persistence preserves the safe RPC domain error ${domainCode}`, async () => {
    const supabase = {
      rpc: async () => ({
        data: null,
        error: { code: "P0001", details: "private database detail", message: domainCode },
      }),
    }
    const { createApplicantWorkflowDependencies } = await import(
      "../../lib/coach-certification/applicant-repository.ts"
    )

    const result = await createApplicantWorkflowDependencies(supabase).updateApplication(
      "owner",
      validApplication(),
    )

    assert.deepEqual(result, { errorCode: domainCode, profile: null })
    assert.equal(JSON.stringify(result).includes("private database detail"), false)
  })
}

test("draft persistence does not expose an unknown RPC message", async () => {
  const supabase = {
    rpc: async () => ({
      data: null,
      error: { code: "P0001", details: "private database detail", message: "raw db failure" },
    }),
  }
  const { createApplicantWorkflowDependencies } = await import(
    "../../lib/coach-certification/applicant-repository.ts"
  )

  const result = await createApplicantWorkflowDependencies(supabase).updateApplication(
    "owner",
    validApplication(),
  )

  assert.deepEqual(result, { errorCode: "P0001", profile: null })
})

function validApplication() {
  return {
    bankAccountLast4: "1234",
    bankName: "SPOLINK 은행",
    bio: "안전한 입문 수업을 진행합니다.",
    careerYears: 4,
    headline: "입문 전문 지도자",
    payoutHolderName: "신청자",
    primarySportId: "00000000-0000-4000-8000-000000000003",
    serviceRegion: "서울 강남구",
  }
}
