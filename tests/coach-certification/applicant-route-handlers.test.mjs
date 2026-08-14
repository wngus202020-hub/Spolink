import assert from "node:assert/strict"
import test from "node:test"

import "../profile-api/fixtures.mjs"

const origin = "http://spolink.test"

test("Given no verified identity, when the applicant profile is read, then the route returns private 401", async () => {
  // Given
  const handlers = await loadHandlers()
  const calls = []
  const handler = handlers.createGetCoachApplicationRouteHandler(makeDependencies(calls))

  // When
  const response = await handler()

  // Then
  assert.equal(response.status, 401)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(calls, ["configured", "dependencies", "claims"])
})

test("Given a cross-origin draft save, when PUT is handled, then no dependency is reached", async () => {
  // Given
  const handlers = await loadHandlers()
  const calls = []
  const handler = handlers.createPutCoachApplicationRouteHandler(makeDependencies(calls))

  // When
  const response = await handler(
    request("PUT", validApplication(), { requestOrigin: "https://attacker.invalid" }),
  )

  // Then
  assert.equal(response.status, 403)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(calls, [])
})

test("Given client-controlled status fields, when PUT is handled, then validation stops before config", async () => {
  // Given
  const handlers = await loadHandlers()
  const calls = []
  const handler = handlers.createPutCoachApplicationRouteHandler(makeDependencies(calls))

  // When
  const response = await handler(request("PUT", { ...validApplication(), status: "approved" }))

  // Then
  assert.equal(response.status, 422)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(calls, [])
})

test("Given public URL or foreign profile metadata, when certificate registration is handled, then it is rejected before config", async () => {
  // Given
  const handlers = await loadHandlers()
  const calls = []
  const handler = handlers.createRegisterCertificateRouteHandler(makeDependencies(calls))

  // When
  const responses = await Promise.all([
    handler(
      request("POST", {
        certificateName: "생활스포츠지도사",
        objectName: "https://public.invalid/cert.pdf",
      }),
    ),
    handler(
      request("POST", {
        certificateName: "생활스포츠지도사",
        coachProfileId: "00000000-0000-4000-8000-000000000002",
        objectName: "00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000004.pdf",
      }),
    ),
  ])

  // Then
  assert.deepEqual(
    responses.map((response) => response.status),
    [422, 422],
  )
  assert.deepEqual(calls, [])
})

test("Given oversized or unsupported upload metadata, when signing is requested, then no upload URL is created", async () => {
  // Given
  const handlers = await loadHandlers()
  const calls = []
  const handler = handlers.createCertificateUploadRouteHandler(makeDependencies(calls))

  // When
  const responses = await Promise.all([
    handler(request("POST", { mimeType: "text/plain", sizeBytes: 10 })),
    handler(request("POST", { mimeType: "image/png", sizeBytes: 10 * 1024 * 1024 + 1 })),
  ])

  // Then
  assert.deepEqual(
    responses.map((response) => response.status),
    [422, 422],
  )
  assert.deepEqual(calls, [])
})

for (const [rpcCode, statusCode] of [
  ["COACH_APPLICATION_CONFLICT", 409],
  ["FORBIDDEN", 403],
  ["ACCOUNT_SUSPENDED", 403],
]) {
  test(`Given the draft RPC returns ${rpcCode}, when PUT is handled, then the route preserves the typed domain response`, async () => {
    const handlers = await loadHandlers()
    const handler = handlers.createPutCoachApplicationRouteHandler(domainErrorDependencies(rpcCode))

    const response = await handler(request("PUT", validApplication()))

    assert.equal(response.status, statusCode)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.equal((await response.json()).error.code, rpcCode)
  })
}

async function loadHandlers() {
  try {
    return await import("../../lib/coach-certification/applicant-route-handlers.ts")
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ERR_MODULE_NOT_FOUND" ||
      !("url" in error) ||
      typeof error.url !== "string" ||
      !error.url.endsWith("/applicant-route-handlers.ts")
    ) {
      throw error
    }
    const missing = () => async () => new Response(null, { status: 501 })
    return {
      createCertificateUploadRouteHandler: missing,
      createGetCoachApplicationRouteHandler: missing,
      createPutCoachApplicationRouteHandler: missing,
      createRegisterCertificateRouteHandler: missing,
    }
  }
}

function makeDependencies(calls) {
  return {
    createWorkflowDependencies: async () => {
      calls.push("dependencies")
      return {
        createCertificate: async () => ({ errorCode: null, row: null }),
        createSignedUpload: async () => ({ errorCode: null, result: null }),
        deleteCertificate: async () => ({ errorCode: null }),
        getVerifiedAuthUser: async () => {
          calls.push("claims")
          return null
        },
        readAccount: async () => ({ errorCode: null, row: null }),
        readApplication: async () => ({ certificates: [], errorCode: null, profile: null }),
        updateApplication: async () => ({ errorCode: null, profile: null }),
      }
    },
    isSupabaseConfigured: () => {
      calls.push("configured")
      return true
    },
  }
}

function domainErrorDependencies(errorCode) {
  return {
    createWorkflowDependencies: async () => ({
      createCertificate: async () => ({ errorCode: null, row: null }),
      createSignedUpload: async () => ({ errorCode: null, result: null }),
      deleteCertificate: async () => ({ errorCode: null }),
      getVerifiedAuthUser: async () => ({ id: "00000000-0000-4000-8000-000000000001" }),
      readAccount: async () => ({
        errorCode: null,
        row: {
          deleted_at: null,
          id: "00000000-0000-4000-8000-000000000001",
          role: "learner",
          status: "active",
        },
      }),
      readApplication: async () => ({ certificates: [], errorCode: null, profile: null }),
      updateApplication: async () => ({ errorCode, profile: null }),
    }),
    isSupabaseConfigured: () => true,
  }
}

function request(method, body, options = {}) {
  return new Request(`${origin}/api/coach-profile/me`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: options.requestOrigin ?? origin,
    },
    method,
  })
}

function validApplication() {
  return {
    bankAccountLast4: "1234",
    bankName: "SPOLINK 은행",
    bio: "초보자도 안전하게 배울 수 있도록 수업합니다.",
    careerYears: 5,
    headline: "입문 전문 지도자",
    payoutHolderName: "홍길동",
    primarySportId: "00000000-0000-4000-8000-000000000003",
    serviceRegion: "서울 강남구",
  }
}
