import assert from "node:assert/strict"
import test from "node:test"

import "../profile-api/fixtures.mjs"

const coachProfileId = "10000000-0000-4000-8000-000000000001"
const certificateId = "10000000-0000-4000-8000-000000000002"

for (const [kind, expectedStatus] of [
  ["unauthenticated", 401],
  ["forbidden", 403],
]) {
  test(`Given ${kind} access, when admin review is attempted, then no write occurs`, async () => {
    const { runReviewAdminCoachApplication } = await import(
      "../../lib/coach-certification/admin-workflow.ts"
    )
    let writes = 0
    const result = await runReviewAdminCoachApplication(coachProfileId, "approve", null, {
      ...unusedDependencies(),
      getVerifiedAdmin: async () => ({ kind }),
      reviewApplication: async () => {
        writes += 1
        throw new Error("review must not run")
      },
    })

    assert.equal(result.status, "failure")
    assert.equal(result.error.statusCode, expectedStatus)
    assert.equal(writes, 0)
  })
}

for (const [errorCode, expectedStatus] of [
  ["COACH_APPLICATION_NOT_FOUND", 404],
  ["COACH_APPLICATION_CONFLICT", 409],
  ["VALIDATION_ERROR", 422],
]) {
  test(`Given RPC error ${errorCode}, when admin reviews, then the stable status is returned`, async () => {
    const { runReviewAdminCoachApplication } = await import(
      "../../lib/coach-certification/admin-workflow.ts"
    )
    const result = await runReviewAdminCoachApplication(
      coachProfileId,
      "reject",
      "보완이 필요합니다.",
      {
        ...unusedDependencies(),
        getVerifiedAdmin: activeAdmin,
        reviewApplication: async () => ({ data: null, errorCode }),
      },
    )

    assert.equal(result.status, "failure")
    assert.equal(result.error.statusCode, expectedStatus)
  })
}

test("Given an active admin, when a private certificate is opened, then the 300-second read is returned", async () => {
  const { runCreateAdminCertificateRead } = await import(
    "../../lib/coach-certification/admin-workflow.ts"
  )
  const result = await runCreateAdminCertificateRead(coachProfileId, certificateId, {
    ...unusedDependencies(),
    createCertificateRead: async (adminId, profileId, selectedCertificateId) => ({
      data: { expiresIn: 300, readUrl: "https://signed.invalid/redacted" },
      errorCode: null,
      observed: { adminId, profileId, selectedCertificateId },
    }),
    getVerifiedAdmin: activeAdmin,
  })

  assert.equal(result.status, "success")
  assert.deepEqual(result.response.data, {
    expiresIn: 300,
    readUrl: "https://signed.invalid/redacted",
  })
})

function activeAdmin() {
  return Promise.resolve({
    kind: "admin",
    user: { id: "20000000-0000-4000-8000-000000000001" },
  })
}

function unusedDependencies() {
  return {
    createCertificateRead: async () => {
      throw new Error("unused")
    },
    getVerifiedAdmin: activeAdmin,
    listApplications: async () => {
      throw new Error("unused")
    },
    readApplication: async () => {
      throw new Error("unused")
    },
    reviewApplication: async () => {
      throw new Error("unused")
    },
  }
}
