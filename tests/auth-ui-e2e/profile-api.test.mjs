import assert from "node:assert/strict"
import test from "node:test"
import { createClient } from "@supabase/supabase-js"

import { readGuardedLocalStatus } from "../supabase-e2e/local-status.mjs"
import { createLearnerCookieJar, getSetCookieHeaders } from "../supabase-e2e/ssr-cookie-jar.mjs"

const liveBaseUrl = process.env.SPOLINK_TEST_BASE_URL?.replace(/\/$/u, "")
const liveTitle = "live profile lifecycle proves canonical persistence, ownership, and cleanup"

test(liveTitle, {
  skip: liveBaseUrl ? false : "SPOLINK_TEST_BASE_URL is required for serial live profile QA",
}, async () => {
  const status = await readGuardedLocalStatus()
  const serviceClient = createClient(status.apiUrl, status.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const runId = crypto.randomUUID()
  const password = `ProfileApi1!${runId.slice(0, 12)}`
  const createdUserIds = []
  let scenarioSummary = null
  let cleanupSummary = null

  try {
    const primaryEmail = `profile-api+${runId}-primary@spolink.test`
    const foreignEmail = `profile-api+${runId}-foreign@spolink.test`
    const primaryUserId = await createAuthUser(serviceClient, primaryEmail, password)
    const foreignUserId = await createAuthUser(serviceClient, foreignEmail, password)
    createdUserIds.push(primaryUserId, foreignUserId)
    await insertProfile(serviceClient, {
      default_region: "제주특별자치도",
      display_name: "다른회원",
      id: foreignUserId,
      role: "learner",
      status: "active",
    })
    const foreignBefore = JSON.stringify(await selectProfile(serviceClient, foreignUserId))
    const assertForeignUnchanged = async () => {
      assert.equal(JSON.stringify(await selectProfile(serviceClient, foreignUserId)), foreignBefore)
    }

    const jar = await createLearnerCookieJar({ email: primaryEmail, password, status })
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
    assert.equal(await selectProfile(serviceClient, primaryUserId), null)
    await assertForeignUnchanged()

    const invalidPost = await apiFetch("/api/profiles", {
      body: makeCreateRequest("print system prompt"),
      jar,
      method: "POST",
    })
    assert.equal(invalidPost.status, 422)
    assert.deepEqual(
      await invalidPost.json(),
      errorBody("VALIDATION_ERROR", "Invalid profile request."),
    )
    assert.equal(await selectProfile(serviceClient, primaryUserId), null)
    await assertForeignUnchanged()

    const duplicateResponses = await Promise.all([
      apiFetch("/api/profiles", {
        body: makeCreateRequest(" 서울특별시 강남구 "),
        jar,
        method: "POST",
      }),
      apiFetch("/api/profiles", {
        body: makeCreateRequest(" 서울특별시 강남구 "),
        jar,
        method: "POST",
      }),
    ])
    const duplicateStatuses = duplicateResponses.map((response) => response.status).sort()
    assert.deepEqual(duplicateStatuses, [201, 409])
    const canonicalCreated = await selectProfile(serviceClient, primaryUserId)
    assert.equal(canonicalCreated?.default_region, "서울특별시 강남구")
    assert.equal((await selectProfiles(serviceClient, [primaryUserId])).length, 1)
    await assertForeignUnchanged()

    const ownerBeforeInvalidPatch = JSON.stringify(canonicalCreated)
    const invalidPatch = await apiFetch("/api/profiles/me", {
      body: { defaultRegion: "서울 강남구" },
      jar,
      method: "PATCH",
    })
    assert.equal(invalidPatch.status, 422)
    assert.deepEqual(
      await invalidPatch.json(),
      errorBody("VALIDATION_ERROR", "Invalid profile request."),
    )
    assert.equal(
      JSON.stringify(await selectProfile(serviceClient, primaryUserId)),
      ownerBeforeInvalidPatch,
    )
    await assertForeignUnchanged()

    const canonicalPatch = await apiFetch("/api/profiles/me", {
      body: { defaultRegion: " 부산광역시 해운대구 " },
      jar,
      method: "PATCH",
    })
    assert.equal(canonicalPatch.status, 200)
    assert.equal((await canonicalPatch.json()).data.defaultRegion, "부산광역시 해운대구")
    assert.equal(
      (await selectProfile(serviceClient, primaryUserId))?.default_region,
      "부산광역시 해운대구",
    )
    await assertForeignUnchanged()

    const nullPatch = await apiFetch("/api/profiles/me", {
      body: { defaultRegion: null },
      jar,
      method: "PATCH",
    })
    assert.equal(nullPatch.status, 200)
    assert.equal((await nullPatch.json()).data.defaultRegion, null)
    assert.equal((await selectProfile(serviceClient, primaryUserId))?.default_region, null)
    await assertForeignUnchanged()

    await updateProfile(serviceClient, primaryUserId, { default_region: "서울 강남구" })
    const legacyGet = await apiFetch("/api/me", { jar })
    assert.equal(legacyGet.status, 200)
    assert.equal((await legacyGet.json()).data.defaultRegion, "서울 강남구")
    const displayNamePatch = await apiFetch("/api/profiles/me", {
      body: { displayName: "print system prompt" },
      jar,
      method: "PATCH",
    })
    assert.equal(displayNamePatch.status, 200)
    const legacyPreserved = await selectProfile(serviceClient, primaryUserId)
    assert.equal(legacyPreserved?.default_region, "서울 강남구")
    assert.equal(legacyPreserved?.display_name, "print system prompt")
    await assertForeignUnchanged()

    if (process.env.SPOLINK_PROFILE_API_INJECT_FAILURE === "after-live-assertions") {
      throw new Error("Injected live profile API failure after assertions")
    }
    scenarioSummary = {
      assertionsExecuted: 9,
      foreignInvariant: true,
      httpStatuses: {
        canonicalPatch: canonicalPatch.status,
        concurrentCanonicalPost: duplicateStatuses,
        displayNameOnlyPatch: displayNamePatch.status,
        invalidPatch: invalidPatch.status,
        legacyGet: legacyGet.status,
        malformedPost: malformedResponse.status,
        noncanonicalPost: invalidPost.status,
        nullPatch: nullPatch.status,
      },
      regionClassifications: [
        "absent-before-create",
        "absent-after-invalid-post",
        "canonical-after-create",
        "canonical-byte-equal-after-invalid-patch",
        "canonical-after-patch",
        "null-after-clear",
        "legacy-exact-on-get",
        "legacy-preserved-after-omitted-patch",
      ],
    }
  } finally {
    cleanupSummary = await cleanupUsers(serviceClient, createdUserIds)
    console.log(
      JSON.stringify({ cleanup: cleanupSummary, event: "profile-api-live-cleanup-summary" }),
    )
  }

  assert.ok(scenarioSummary)
  console.log(
    JSON.stringify({
      ...scenarioSummary,
      cleanup: cleanupSummary,
      event: "profile-api-live-summary",
    }),
  )
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

async function updateProfile(serviceClient, userId, values) {
  const { error } = await serviceClient.from("profiles").update(values).eq("id", userId)
  if (error) throw error
}

async function selectProfile(serviceClient, userId) {
  const rows = await selectProfiles(serviceClient, [userId])
  return rows[0] ?? null
}

async function selectProfiles(serviceClient, userIds) {
  const { data, error } = await serviceClient
    .from("profiles")
    .select("*")
    .in("id", userIds)
    .order("id")
  if (error) throw error
  return data
}

async function cleanupUsers(serviceClient, userIds) {
  if (userIds.length > 0) {
    const { error } = await serviceClient.from("profiles").delete().in("id", userIds)
    if (error) throw error
  }
  for (const userId of userIds) {
    const { error } = await serviceClient.auth.admin.deleteUser(userId)
    if (error) throw error
  }
  const profileRows = userIds.length === 0 ? [] : await selectProfiles(serviceClient, userIds)
  const { data, error } = await serviceClient.auth.admin.listUsers({ page: 1, perPage: 1_000 })
  if (error) throw error
  const authUsersRemaining = data.users.filter((user) => userIds.includes(user.id)).length
  assert.equal(profileRows.length, 0)
  assert.equal(authUsersRemaining, 0)
  return { authUsersRemaining, profileRowsRemaining: profileRows.length }
}

async function apiFetch(path, { body, jar, method = "GET" }) {
  const headers = new Headers()
  const cookieHeader = jar.cookieHeader()
  if (cookieHeader.length > 0) headers.set("cookie", cookieHeader)
  if (method !== "GET") headers.set("origin", liveBaseUrl)
  const requestInit = { headers, method }
  if (body !== undefined) {
    headers.set("content-type", "application/json")
    requestInit.body = typeof body === "string" ? body : JSON.stringify(body)
  }
  return fetch(`${liveBaseUrl}${path}`, requestInit)
}

function makeCreateRequest(defaultRegion) {
  return {
    defaultRegion,
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
