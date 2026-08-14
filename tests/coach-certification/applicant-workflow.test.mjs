import assert from "node:assert/strict"
import test from "node:test"

import "../profile-api/fixtures.mjs"

const userId = "00000000-0000-4000-8000-000000000001"
const profileId = "00000000-0000-4000-8000-000000000002"
const sportId = "00000000-0000-4000-8000-000000000003"

test("Given an editable draft, when the same save is retried, then it is idempotent and remains owner-scoped", async () => {
  // Given
  const { runSaveCoachApplication } = await import(
    "../../lib/coach-certification/applicant-workflow.ts"
  )
  const fake = makeFake()
  const request = validRequest()

  // When
  const first = await runSaveCoachApplication(request, fake.dependencies)
  const second = await runSaveCoachApplication(request, fake.dependencies)

  // Then
  assert.equal(first.status, "success")
  assert.equal(second.status, "success")
  assert.equal(first.response.data?.id, profileId)
  assert.equal(second.response.data?.id, profileId)
  assert.equal(fake.updateCount, 2)
  assert.deepEqual(fake.updatedOwners, [userId, userId])
})

for (const status of ["submitted", "approved", "suspended"]) {
  test(`Given ${status} application data, when a save is attempted, then no write occurs`, async () => {
    // Given
    const { runSaveCoachApplication } = await import(
      "../../lib/coach-certification/applicant-workflow.ts"
    )
    const fake = makeFake({ status })

    // When
    const result = await runSaveCoachApplication(validRequest(), fake.dependencies)

    // Then
    assert.equal(result.status, "failure")
    assert.equal(result.error.code, "COACH_APPLICATION_CONFLICT")
    assert.equal(result.error.statusCode, 409)
    assert.equal(fake.updateCount, 0)
  })
}

test("Given a suspended owner, when a save is attempted, then authorization fails without a write", async () => {
  // Given
  const { runSaveCoachApplication } = await import(
    "../../lib/coach-certification/applicant-workflow.ts"
  )
  const fake = makeFake({ accountStatus: "suspended", status: "suspended" })

  // When
  const result = await runSaveCoachApplication(validRequest(), fake.dependencies)

  // Then
  assert.equal(result.status, "failure")
  assert.equal(result.error.code, "ACCOUNT_SUSPENDED")
  assert.equal(result.error.statusCode, 403)
  assert.equal(fake.updateCount, 0)
})

for (const [rpcCode, expectedCode, expectedStatus] of [
  ["ACCOUNT_DELETED", "ACCOUNT_DELETED", 403],
  ["ACCOUNT_SUSPENDED", "ACCOUNT_SUSPENDED", 403],
  ["COACH_APPLICATION_CONFLICT", "COACH_APPLICATION_CONFLICT", 409],
  ["FORBIDDEN", "FORBIDDEN", 403],
  ["PROFILE_REQUIRED", "PROFILE_REQUIRED", 409],
  ["UNAUTHORIZED", "UNAUTHORIZED", 401],
  ["VALIDATION_ERROR", "VALIDATION_ERROR", 422],
]) {
  test(`Given an RPC race returns ${rpcCode}, when a draft is saved, then the typed HTTP failure is preserved`, async () => {
    const { runSaveCoachApplication } = await import(
      "../../lib/coach-certification/applicant-workflow.ts"
    )
    const fake = makeFake({ updateErrorCode: rpcCode })

    const result = await runSaveCoachApplication(validRequest(), fake.dependencies)

    assert.equal(result.status, "failure")
    assert.equal(result.error.code, expectedCode)
    assert.equal(result.error.statusCode, expectedStatus)
    assert.notEqual(result.error.code, "INTERNAL_ERROR")
  })
}

test("Given stored certificate metadata, when the application is read, then object names are redacted", async () => {
  // Given
  const { runReadCoachApplication } = await import(
    "../../lib/coach-certification/applicant-workflow.ts"
  )
  const fake = makeFake({ certificate: true })

  // When
  const result = await runReadCoachApplication(fake.dependencies)

  // Then
  assert.equal(result.status, "success")
  assert.equal(result.response.data?.certificates[0]?.certificateName, "생활스포츠지도사")
  const serialized = JSON.stringify(result.response)
  assert.equal(serialized.includes("file_path"), false)
  assert.equal(serialized.includes(`${userId}/`), false)
})

function makeFake(options = {}) {
  let profile = applicationRow(options.status ?? "draft")
  const certificates = options.certificate ? [certificateRow()] : []
  const state = { updateCount: 0, updatedOwners: [] }
  state.dependencies = {
    createCertificate: async () => ({ errorCode: null, row: null }),
    createSignedUpload: async () => ({ errorCode: null, result: null }),
    deleteCertificate: async () => ({ errorCode: null }),
    getVerifiedAuthUser: async () => ({ id: userId }),
    readAccount: async () => ({
      errorCode: null,
      row: {
        avatar_path: null,
        default_region: "서울 강남구",
        deleted_at: null,
        display_name: "신청자",
        id: userId,
        location_agreed_at: null,
        marketing_agreed_at: null,
        phone: "010-0000-0000",
        real_name: "홍길동",
        role: "learner",
        status: options.accountStatus ?? "active",
      },
    }),
    readApplication: async () => ({ certificates, errorCode: null, profile }),
    updateApplication: async (ownerId, request) => {
      state.updateCount += 1
      state.updatedOwners.push(ownerId)
      if (options.updateErrorCode) return { errorCode: options.updateErrorCode, profile: null }
      profile = { ...profile, headline: request.headline }
      return { errorCode: null, profile }
    },
  }
  return state
}

function applicationRow(status) {
  return {
    bank_account_last4: "1234",
    bank_name: "SPOLINK 은행",
    bio: "초보자도 안전하게 배울 수 있도록 수업합니다.",
    career_years: 5,
    created_at: "2026-08-13T00:00:00.000Z",
    headline: "입문 전문 지도자",
    id: profileId,
    intro_video_url: null,
    payout_holder_name: "홍길동",
    primary_sport_id: sportId,
    rejection_reason: null,
    reviewed_at: null,
    reviewed_by: null,
    service_region: "서울 강남구",
    status,
    submitted_at: null,
    updated_at: "2026-08-13T00:00:00.000Z",
    user_id: userId,
  }
}

function certificateRow() {
  return {
    certificate_name: "생활스포츠지도사",
    certificate_number: null,
    coach_profile_id: profileId,
    created_at: "2026-08-13T00:00:00.000Z",
    file_path: `${userId}/00000000-0000-4000-8000-000000000004.pdf`,
    id: "00000000-0000-4000-8000-000000000005",
    issuer: null,
    rejected_reason: null,
    updated_at: "2026-08-13T00:00:00.000Z",
    verified_at: null,
  }
}

function validRequest() {
  return {
    bankAccountLast4: "1234",
    bankName: "SPOLINK 은행",
    bio: "초보자도 안전하게 배울 수 있도록 수업합니다.",
    careerYears: 5,
    headline: "입문 전문 지도자",
    payoutHolderName: "홍길동",
    primarySportId: sportId,
    serviceRegion: "서울 강남구",
  }
}
