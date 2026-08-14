import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import test from "node:test"
import { ensureAuthGatewayReady, provisionWithAuthReadiness } from "./auth-rls/runtime.mjs"
import {
  assertCancelledState,
  assertPristineState,
  createCancellationObserver,
  readCancellationState,
} from "./cancellation-observer.mjs"
import { fixedIds, fixtureUsers } from "./fixtures.mjs"
import { acquireLiveQaLock } from "./live-qa-lock.mjs"
import {
  assertNextTypeStability,
  assertNoRootEnvFiles,
  capturePort3002,
  startNextServer,
} from "./next-server.mjs"
import {
  assertSupabaseSsrContracts,
  createLearnerCookieJar,
  getSetCookieHeaders,
  sha256,
} from "./ssr-cookie-jar.mjs"

const cancellationPath = `/api/reservations/${fixedIds.cancellableReservation}/cancel`
const successReason = "Todo5 authenticated"

let provision
let observer
let server
let before3002
let releaseLiveQaLock
let setupProof
let typeHashBefore
const observations = []

test.before(async () => {
  releaseLiveQaLock = await acquireLiveQaLock("cancellation-api")
  await assertNoRootEnvFiles()
  typeHashBefore = await assertNextTypeStability()
  await assertSupabaseSsrContracts()
  before3002 = await capturePort3002()
  await ensureAuthGatewayReady()
  provision = await provisionWithAuthReadiness()
  observer = createCancellationObserver(provision.status)
  setupProof = await cycleNextServers()
})

test.after(async () => {
  try {
    if (process.env.SPOLINK_E2E_OBSERVER_ARTIFACT) {
      await writeFile(
        process.env.SPOLINK_E2E_OBSERVER_ARTIFACT,
        JSON.stringify(
          {
            after3002: await capturePort3002(),
            before3002,
            observations,
            setupProof,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      )
    }
    if (server) await server.stop()
    if (observer) await observer.end({ timeout: 1 })
    if (provision) await provision.cleanup()
  } finally {
    if (releaseLiveQaLock) await releaseLiveQaLock()
  }
})

test("server ownership: configured and unconfigured Next cycles preserve type files and port 3002", async () => {
  if (setupProof.externalBaseUrl) {
    assert.equal(server.ownedPid, null)
    assert.equal(setupProof.configured.configured, true)
    assert.equal(setupProof.configured.port, new URL(process.env.SPOLINK_TEST_BASE_URL).port)
    assert.equal(await assertNextTypeStability(), typeHashBefore)
    assert.equal(await capturePort3002(), before3002)
    return
  }
  assert.equal(setupProof.unconfigured.configured, false)
  assert.equal(setupProof.configured.configured, true)
  assert.notEqual(setupProof.unconfigured.port, 3002)
  assert.notEqual(setupProof.configured.port, 3002)
  assert.equal(await assertNextTypeStability(), typeHashBefore)
  assert.equal(await capturePort3002(), before3002)
})

test("unauthenticated cancellation returns 401 and leaves database state pristine", async () => {
  const response = await postJson({ reason: "Todo5 unauthenticated" })
  const body = await response.json()

  assert.equal(response.status, 401)
  assert.deepEqual(body, {
    error: { code: "UNAUTHORIZED", details: [], message: "Authentication required." },
  })
  const state = await readCancellationState(observer)
  assertPristineState(state)
  recordObservation("unauthenticated", response, body, state)
})

test("malformed cancellation input returns 422 before reservation mutation", async () => {
  const response = await postJson({ reason: "" })
  const body = await response.json()

  assert.equal(response.status, 422)
  assert.equal(body.error.code, "VALIDATION_ERROR")
  const state = await readCancellationState(observer)
  assertPristineState(state)
  recordObservation("malformed", response, body, state)
})

test("unrelated learner cancellation returns 403 and preserves state", async () => {
  const jar = await createPersonaJar("otherLearner")
  const response = await postJson({ reason: "Todo5 unrelated" }, jar)
  const body = await response.json()

  assert.equal(response.status, 403)
  assert.deepEqual(body, {
    error: {
      code: "FORBIDDEN",
      details: [],
      message: "Reservation cancellation is forbidden.",
    },
  })
  const state = await readCancellationState(observer)
  assertPristineState(state)
  recordObservation("unrelated learner", response, body, state)
})

test("authenticated learner cancellation refreshes SSR cookies and supports a second auth request", async () => {
  const jar = await createPersonaJar("learner")
  const originalCookieHashes = jar.values().map(sha256)
  const expirationProof = jar.expireSessionMetadata()
  const staleChunkName = jar.addStaleAuthChunk()

  const response = await postJson({ reason: successReason }, jar)
  const refreshedCookies = getSetCookieHeaders(response)
  jar.mergeSetCookieHeaders(refreshedCookies)
  const body = await response.json()

  assert.equal(response.status, 200)
  assertCancellationEnvelope(body)
  assert.equal(refreshedCookies.length > 1, true)
  assert.equal(
    refreshedCookies.some((header) => header.startsWith(`${staleChunkName}=`)),
    true,
  )
  assert.notDeepEqual(jar.values().map(sha256), originalCookieHashes)
  assert.equal(expirationProof.originalHash.length, 64)
  assert.equal(expirationProof.expiredHash.length, 64)
  const state = await readCancellationState(observer)
  assertCancelledState(state, {
    reason: successReason,
    response: body,
  })
  recordObservation("authenticated learner", response, body, state, {
    setCookieCount: refreshedCookies.length,
    setCookieNameHashes: refreshedCookies.map((header) => sha256(header.split("=")[0])),
  })

  const secondResponse = await postJson({ reason: successReason }, jar)
  const secondBody = await secondResponse.json()
  assert.equal(secondResponse.status, 200)
  assert.equal(secondBody.data.reservationId, fixedIds.cancellableReservation)
  recordObservation("authenticated learner repeat", secondResponse, secondBody, state)
  assert.equal(await capturePort3002(), before3002)
})

async function cycleNextServers() {
  if (process.env.SPOLINK_TEST_BASE_URL) {
    server = await startNextServer({ mode: "configured", status: provision.status })
    return {
      configured: {
        ...(await readConfig(server.baseUrl)),
        port: new URL(server.baseUrl).port,
      },
      externalBaseUrl: true,
    }
  }
  const unconfigured = await startNextServer({ mode: "unconfigured", status: provision?.status })
  const unconfiguredBody = await readConfig(unconfigured.baseUrl)
  const unconfiguredStop = await unconfigured.stop()
  assert.equal(await assertNextTypeStability(), typeHashBefore)

  server = await startNextServer({ mode: "configured", status: provision.status })
  const configuredBody = await readConfig(server.baseUrl)
  assert.equal(await assertNextTypeStability(), typeHashBefore)
  return {
    configured: { ...configuredBody, port: server.port },
    unconfigured: { ...unconfiguredBody, port: unconfigured.port, stop: unconfiguredStop.signal },
  }
}

async function readConfig(baseUrl) {
  const response = await fetch(`${baseUrl}/api/config/supabase`)
  assert.equal(response.status, 200)
  return response.json()
}

async function postJson(body, jar = null) {
  const headers = {
    "content-type": "application/json",
    origin: new URL(server.baseUrl).origin,
  }
  if (jar) headers.cookie = jar.cookieHeader()
  return fetch(`${server.baseUrl}${cancellationPath}`, {
    body: JSON.stringify(body),
    headers,
    method: "POST",
  })
}

async function createPersonaJar(key) {
  const user = fixtureUsers.find((candidate) => candidate.key === key)
  if (!user) throw new Error(`Missing fixture user: ${key}`)
  return createLearnerCookieJar({
    status: provision.status,
    email: user.email,
    password: provision.runPassword,
  })
}

function assertCancellationEnvelope(body) {
  assert.deepEqual(Object.keys(body), ["data"])
  assert.deepEqual(Object.keys(body.data).sort(), [
    "cancelledAt",
    "refund",
    "reservationId",
    "status",
  ])
  assert.equal(body.data.reservationId, fixedIds.cancellableReservation)
  assert.equal(body.data.status, "cancelled_by_user")
  assert.equal(Number.isNaN(Date.parse(body.data.cancelledAt)), false)
  assert.equal(body.data.refund.amount, 7000)
  assert.equal(body.data.refund.status, "requested")
  assert.match(body.data.refund.id, /^[0-9a-f-]{36}$/)
}

function recordObservation(name, response, body, state, extra = {}) {
  observations.push({
    ...extra,
    bodySha256: sha256(JSON.stringify(body)),
    dbStateSha256: sha256(JSON.stringify(state)),
    name,
    status: response.status,
  })
}
