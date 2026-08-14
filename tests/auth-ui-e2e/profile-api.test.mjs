import assert from "node:assert/strict"
import test from "node:test"
import { createClient } from "@supabase/supabase-js"

import { readGuardedLocalStatus } from "../supabase-e2e/local-status.mjs"
import { createLearnerCookieJar, getSetCookieHeaders } from "../supabase-e2e/ssr-cookie-jar.mjs"

const liveBaseUrl = process.env.SPOLINK_TEST_BASE_URL?.replace(/\/$/, "")

test("live profile lifecycle exercises real route handlers, RLS owner patch, cookies, and duplicate POST", {
  skip: liveBaseUrl ? false : "SPOLINK_TEST_BASE_URL is required for serial live profile QA",
}, async () => {
  const status = await readGuardedLocalStatus()
  const serviceClient = createClient(status.apiUrl, status.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const runId = crypto.randomUUID()
  const password = `ProfileApi1!${runId.slice(0, 12)}`
  const createdUserIds = []

  try {
    const primaryEmail = `profile-api+${runId}-primary@spolink.test`
    const unrelatedEmail = `profile-api+${runId}-unrelated@spolink.test`
    const primaryUserId = await createAuthUser(serviceClient, primaryEmail, password)
    const unrelatedUserId = await createAuthUser(serviceClient, unrelatedEmail, password)
    createdUserIds.push(primaryUserId, unrelatedUserId)

    await insertProfile(serviceClient, {
      display_name: "다른회원",
      id: unrelatedUserId,
      role: "learner",
      status: "active",
    })

    const jar = await createLearnerCookieJar({
      email: primaryEmail,
      password,
      status,
    })

    jar.expireSessionMetadata()
    const missingResponse = await apiFetch("/api/me", { jar })
    assert.equal(missingResponse.status, 409)
    assert.equal(missingResponse.headers.get("cache-control"), "private, no-store")
    assert.deepEqual(
      await missingResponse.json(),
      errorBody("PROFILE_REQUIRED", "Profile setup required."),
    )
    const refreshedCookies = getSetCookieHeaders(missingResponse)
    assert.equal(refreshedCookies.length > 0, true)
    jar.mergeSetCookieHeaders(refreshedCookies)

    const malformedResponse = await apiFetch("/api/profiles", {
      body: "{",
      jar,
      method: "POST",
    })
    assert.equal(malformedResponse.status, 422)
    assert.deepEqual(
      await malformedResponse.json(),
      errorBody("VALIDATION_ERROR", "Request body must be valid JSON."),
    )

    const duplicateResponses = await Promise.all([
      apiFetch("/api/profiles", { body: makeCreateRequest(), jar, method: "POST" }),
      apiFetch("/api/profiles", { body: makeCreateRequest(), jar, method: "POST" }),
    ])
    assert.deepEqual(duplicateResponses.map((response) => response.status).sort(), [201, 409])

    const profileRows = await selectProfiles(serviceClient, [primaryUserId, unrelatedUserId])
    assert.equal(profileRows.length, 2)
    const primaryProfile = profileRows.find((row) => row.id === primaryUserId)
    const unrelatedProfile = profileRows.find((row) => row.id === unrelatedUserId)
    assert.equal(primaryProfile?.role, "learner")
    assert.equal(primaryProfile?.status, "active")
    assert.equal(unrelatedProfile?.display_name, "다른회원")

    const patchResponse = await apiFetch("/api/profiles/me", {
      body: {
        avatarPath: `profiles/${primaryUserId}/avatar.png`,
        displayName: "새이름",
        locationAgreed: true,
        marketingAgreed: false,
      },
      jar,
      method: "PATCH",
    })
    assert.equal(patchResponse.status, 200)
    const patchBody = await patchResponse.json()
    assert.equal(patchBody.data.id, primaryUserId)
    assert.equal(patchBody.data.displayName, "새이름")
    assert.equal(patchBody.data.marketingAgreedAt, null)

    const afterPatchRows = await selectProfiles(serviceClient, [primaryUserId, unrelatedUserId])
    assert.equal(afterPatchRows.find((row) => row.id === unrelatedUserId)?.display_name, "다른회원")
    assert.equal(afterPatchRows.find((row) => row.id === primaryUserId)?.display_name, "새이름")
  } finally {
    await cleanupUsers(serviceClient, createdUserIds)
  }
})

async function createAuthUser(serviceClient, email, password) {
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  })
  if (error) throw error
  if (!data.user?.id) throw new Error("Auth admin createUser did not return an id")
  return data.user.id
}

async function insertProfile(serviceClient, row) {
  const { error } = await serviceClient.from("profiles").insert(row)
  if (error) throw error
}

async function selectProfiles(serviceClient, userIds) {
  const { data, error } = await serviceClient
    .from("profiles")
    .select("id,role,status,display_name")
    .in("id", userIds)
    .order("id")
  if (error) throw error
  return data
}

async function cleanupUsers(serviceClient, userIds) {
  if (userIds.length > 0) {
    await serviceClient.from("profiles").delete().in("id", userIds)
  }
  for (const userId of userIds) {
    await serviceClient.auth.admin.deleteUser(userId)
  }
}

async function apiFetch(path, { body, jar, method = "GET" }) {
  const headers = new Headers()
  const cookieHeader = jar.cookieHeader()
  if (cookieHeader.length > 0) headers.set("cookie", cookieHeader)
  const requestInit = { headers, method }
  if (body !== undefined) {
    headers.set("content-type", "application/json")
    requestInit.body = typeof body === "string" ? body : JSON.stringify(body)
  }

  return fetch(`${liveBaseUrl}${path}`, requestInit)
}

function makeCreateRequest() {
  return {
    defaultRegion: "서울 강남구",
    displayName: "홍길동",
    locationAgreed: true,
    marketingAgreed: false,
    phone: "010-1234-5678",
    realName: "홍길동",
  }
}

function errorBody(code, message) {
  return { error: { code, details: [], message } }
}
