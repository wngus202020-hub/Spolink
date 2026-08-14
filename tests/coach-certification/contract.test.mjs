import assert from "node:assert/strict"
import test from "node:test"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const COACH_PROFILE_ID = "00000000-0000-4000-8000-000000000002"
const SPORT_ID = "00000000-0000-4000-8000-000000000003"
const CERTIFICATE_ID = "00000000-0000-4000-8000-000000000004"
const REVIEWER_ID = "00000000-0000-4000-8000-000000000005"

function validApplicationRequest() {
  return {
    bankAccountLast4: "1234",
    bankName: "SPOLINK 은행",
    bio: "초보자도 안전하게 배울 수 있도록 테니스 레슨을 진행합니다.",
    careerYears: 5,
    headline: "테니스 입문 전문 코치",
    payoutHolderName: "홍길동",
    primarySportId: SPORT_ID,
    serviceRegion: "서울 강남구",
  }
}

function validCertificateRequest() {
  return {
    certificateName: "생활스포츠지도사",
    certificateNumber: "T-2026-0001",
    filePath: `${USER_ID}/certificate.pdf`,
    issuer: "문화체육관광부",
  }
}

test("Given an editable draft, when the applicant contract is parsed and mapped, then it returns redacted metadata", async () => {
  const contract = await import("../../lib/coach-certification/contract.ts")

  // Given
  const request = validApplicationRequest()
  const profile = {
    bank_account_last4: request.bankAccountLast4,
    bank_name: request.bankName,
    bio: request.bio,
    career_years: request.careerYears,
    created_at: "2026-08-12T00:00:00.000Z",
    headline: request.headline,
    id: COACH_PROFILE_ID,
    intro_video_url: null,
    payout_holder_name: request.payoutHolderName,
    primary_sport_id: SPORT_ID,
    rejection_reason: null,
    reviewed_at: null,
    reviewed_by: null,
    service_region: request.serviceRegion,
    status: "draft",
    submitted_at: null,
    updated_at: "2026-08-12T00:00:00.000Z",
    user_id: USER_ID,
  }
  const certificate = {
    certificate_name: "생활스포츠지도사",
    certificate_number: "T-2026-0001",
    coach_profile_id: COACH_PROFILE_ID,
    created_at: "2026-08-12T00:00:00.000Z",
    file_path: `${USER_ID}/certificate.pdf`,
    id: CERTIFICATE_ID,
    issuer: "문화체육관광부",
    rejected_reason: null,
    updated_at: "2026-08-12T00:00:00.000Z",
    verified_at: null,
  }

  // When
  const parsed = contract.parseCoachApplicationRequest(request)
  const response = contract.mapCoachCertificationResponse(profile, [certificate])

  // Then
  assert.deepEqual(parsed, request)
  assert.equal(contract.isCoachCertificationEditable("draft"), true)
  assert.deepEqual(response, {
    data: {
      certificates: [
        {
          certificateName: "생활스포츠지도사",
          certificateNumber: "T-2026-0001",
          id: CERTIFICATE_ID,
          issuer: "문화체육관광부",
          verifiedAt: null,
        },
      ],
      headline: request.headline,
      id: COACH_PROFILE_ID,
      serviceRegion: request.serviceRegion,
      status: "draft",
    },
  })
  assert.equal(JSON.stringify(response).includes("file_path"), false)
  assert.equal(JSON.stringify(response).includes("bank_account_last4"), false)
})

test("Given untrusted certification payloads, when request boundaries parse them, then invalid and reviewer-controlled fields are rejected", async () => {
  const contract = await import("../../lib/coach-certification/contract.ts")

  // Given
  const oversizedHeadline = "가".repeat(121)
  const invalidCases = [
    { ...validApplicationRequest(), primarySportId: "not-a-uuid" },
    { ...validApplicationRequest(), headline: "   " },
    { ...validApplicationRequest(), headline: oversizedHeadline },
    { ...validApplicationRequest(), status: "approved" },
    { ...validApplicationRequest(), reviewedBy: REVIEWER_ID },
    { ...validApplicationRequest(), submittedAt: "2026-08-12T00:00:00.000Z" },
  ]
  const invalidCertificateCases = [
    { ...validCertificateRequest(), certificateName: "" },
    { ...validCertificateRequest(), filePath: "https://storage.example/certificate.pdf" },
    { ...validCertificateRequest(), filePath: "../certificate.pdf" },
    { ...validCertificateRequest(), verifiedAt: "2026-08-12T00:00:00.000Z" },
  ]

  // When / Then
  for (const value of invalidCases) {
    assert.equal(contract.parseCoachApplicationRequest(value), null)
  }
  for (const value of invalidCertificateCases) {
    assert.equal(contract.parseCertificateMetadataRequest(value), null)
  }
  assert.equal(
    contract.parseOwnedCertificateMetadataRequest(validCertificateRequest(), REVIEWER_ID),
    null,
  )
  assert.equal(contract.parseCoachCertificationStatus("pending_review"), null)
})

test("Given coach certification statuses, when transitions are read, then exact learner status tuples and retry semantics apply", async () => {
  const contract = await import("../../lib/coach-certification/contract.ts")

  // Given
  const expectedTuples = {
    approved: { coachStatus: "approved", profileRole: "learner", profileStatus: "coach_approved" },
    draft: { coachStatus: "draft", profileRole: "learner", profileStatus: "active" },
    rejected: { coachStatus: "rejected", profileRole: "learner", profileStatus: "active" },
    submitted: { coachStatus: "submitted", profileRole: "learner", profileStatus: "pending_coach" },
    suspended: { coachStatus: "suspended", profileRole: "learner", profileStatus: "suspended" },
  }

  // When
  const draftSubmission = contract.readCoachSubmissionTransition("draft")
  const rejectedSubmission = contract.readCoachSubmissionTransition("rejected")
  const approval = contract.readCoachReviewTransition("submitted", "approve")
  const rejection = contract.readCoachReviewTransition("submitted", "reject")

  // Then
  assert.deepEqual(contract.COACH_CERTIFICATION_STATUS_TUPLES, expectedTuples)
  assert.deepEqual(draftSubmission, {
    clearReviewFields: false,
    kind: "transition",
    next: expectedTuples.submitted,
  })
  assert.deepEqual(rejectedSubmission, {
    clearReviewFields: true,
    kind: "transition",
    next: expectedTuples.submitted,
  })
  assert.deepEqual(approval, { kind: "transition", next: expectedTuples.approved })
  assert.deepEqual(rejection, { kind: "transition", next: expectedTuples.rejected })
  assert.deepEqual(contract.readCoachReviewTransition("approved", "approve"), {
    kind: "idempotent",
  })
  assert.deepEqual(contract.readCoachReviewTransition("approved", "reject"), { kind: "conflict" })
  assert.deepEqual(contract.readCoachSubmissionTransition("submitted"), { kind: "conflict" })
  assert.equal(contract.isCoachCertificationEditable("submitted"), false)
  assert.equal(contract.isCoachCertificationEditable("approved"), false)
  assert.equal(contract.isCoachCertificationEditable("suspended"), false)
})

test("Given an admin decision payload, when it is parsed, then only a bounded rejection reason is accepted", async () => {
  const contract = await import("../../lib/coach-certification/contract.ts")

  // Given
  const validReject = { rejectionReason: "필수 자격증의 발급 기관을 확인할 수 없습니다." }

  // When
  const rejectRequest = contract.parseAdminCoachReviewRequest("reject", validReject)

  // Then
  assert.deepEqual(rejectRequest, validReject)
  assert.deepEqual(contract.parseAdminCoachReviewRequest("approve", {}), {})
  assert.equal(contract.parseAdminCoachReviewRequest("reject", {}), null)
  assert.equal(
    contract.parseAdminCoachReviewRequest("reject", { rejectionReason: "가".repeat(1001) }),
    null,
  )
  assert.equal(contract.parseAdminCoachReviewRequest("approve", { reviewedBy: REVIEWER_ID }), null)
})
