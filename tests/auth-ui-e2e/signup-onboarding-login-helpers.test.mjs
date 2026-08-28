import assert from "node:assert/strict"
import { register } from "node:module"
import test from "node:test"
import { pathToFileURL } from "node:url"

const repoUrl = pathToFileURL(`${process.cwd()}/`).href

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@/")) return nextResolve("${repoUrl}" + specifier.slice(2) + ".ts", context);
      if (specifier.startsWith("./") && !specifier.match(/\\.[cm]?[jt]s$/)) {
        return nextResolve(specifier + ".ts", context);
      }
      return nextResolve(specifier, context);
    }
  `)}`,
  import.meta.url,
)

const { testEmail, testPassword } = await import("./auth-form-helpers.ts")
const { cleanupLiveAuthUser } = await import("./auth-recovery-helpers.ts")
const {
  SignupCleanupError,
  SignupOnboardingObservationError,
  SignupProfileAssertionError,
  assertPersistedSignupProfile,
  attachBrowserFailureCollector,
  createOnboarding422RetryReceipt,
  createRejectedRegionTextReceipt,
  createSingleOnboardingSubmissionReceipt,
  createSignupJourneyFixture,
  runWithSignupCleanup,
} = await import("./signup-onboarding-login-helpers.ts")

const expectedProfile = Object.freeze({
  defaultRegion: "서울특별시 강남구",
  displayName: "스포링커",
  locationAgreed: true,
  marketingAgreed: false,
  phone: "010-1234-5678",
  realName: "김스포츠",
})

test("onboarding observation contract accepts behavior-equivalent source refactors", () => {
  const reads = []
  const refactoredObservationSource = {
    readPayloads() {
      reads.push("payloads")
      return [
        {
          realName: expectedProfile.realName,
          phone: expectedProfile.phone,
          marketingAgreed: expectedProfile.marketingAgreed,
          locationAgreed: expectedProfile.locationAgreed,
          displayName: expectedProfile.displayName,
          defaultRegion: expectedProfile.defaultRegion,
        },
      ]
    },
    readExplicitRegionSelection() {
      reads.push("selection")
      return true
    },
  }

  const receipt = createSingleOnboardingSubmissionReceipt(refactoredObservationSource)

  assert.deepEqual(reads.sort(), ["payloads", "selection"])
  assert.deepEqual(receipt, {
    defaultRegion: expectedProfile.defaultRegion,
    kind: "single-submission",
    profileRequestCount: 1,
    verdict: "APPROVE",
  })
})

test("onboarding observation contract rejects free text or missing explicit selection", () => {
  assert.throws(
    () =>
      createRejectedRegionTextReceipt({
        profileRequestCount: 1,
        searchText: "uncommitted-region-query",
        selectedRegion: null,
      }),
    SignupOnboardingObservationError,
  )
  assert.throws(
    () =>
      createSingleOnboardingSubmissionReceipt({
        readExplicitRegionSelection: () => false,
        readPayloads: () => [expectedProfile],
      }),
    SignupOnboardingObservationError,
  )
})

test("onboarding observation contract rejects duplicate profile submission", () => {
  assert.throws(
    () =>
      createSingleOnboardingSubmissionReceipt({
        readExplicitRegionSelection: () => true,
        readPayloads: () => [expectedProfile, expectedProfile],
      }),
    SignupOnboardingObservationError,
  )
})

test("onboarding observation contract rejects lost 422 retention", () => {
  assert.throws(
    () =>
      createOnboarding422RetryReceipt({
        firstPayload: { ...expectedProfile, marketingAgreed: true },
        persistedDefaultRegion: expectedProfile.defaultRegion,
        requestCount: 2,
        retained: {
          consents: true,
          identityFields: true,
          purpose: true,
          regionSelection: false,
        },
        secondPayload: { ...expectedProfile, marketingAgreed: true },
      }),
    SignupOnboardingObservationError,
  )
})

test("onboarding observation contract rejects noncanonical payload or persistence", () => {
  const canonical = { ...expectedProfile, marketingAgreed: true }
  for (const observation of [
    {
      firstPayload: { ...canonical, defaultRegion: "서울 강남구" },
      persistedDefaultRegion: expectedProfile.defaultRegion,
      requestCount: 2,
      retained: { consents: true, identityFields: true, purpose: true, regionSelection: true },
      secondPayload: { ...canonical, defaultRegion: "서울 강남구" },
    },
    {
      firstPayload: canonical,
      persistedDefaultRegion: "서울 강남구",
      requestCount: 2,
      retained: { consents: true, identityFields: true, purpose: true, regionSelection: true },
      secondPayload: canonical,
    },
  ]) {
    assert.throws(
      () => createOnboarding422RetryReceipt(observation),
      SignupOnboardingObservationError,
    )
  }
})

function matchingProbe() {
  return {
    authUserId: "synthetic-auth-user-a",
    defaultRegion: expectedProfile.defaultRegion,
    displayName: expectedProfile.displayName,
    locationAgreedAt: "2026-08-05T01:02:03.000Z",
    marketingAgreedAt: null,
    phone: expectedProfile.phone,
    profileId: "synthetic-auth-user-a",
    realName: expectedProfile.realName,
    role: "learner",
    status: "active",
  }
}

test("baseline: shared credentials are deterministic, unique by label, and fixture-scoped", () => {
  const testInfo = {
    project: { name: "baseline-project" },
    titlePath: ["baseline-suite", "baseline-case"],
  }

  const first = testEmail(testInfo, "first")
  const repeated = testEmail(testInfo, "first")
  const second = testEmail(testInfo, "second")

  assert.equal(first, repeated)
  assert.notEqual(first, second)
  assert.match(first, /@spolink\.test$/u)
  assert.equal(typeof testPassword, "string")
  assert.ok(testPassword.length >= 8)
})

test("baseline: shared cleanup is a no-op without a live DB boundary", async () => {
  const previous = process.env["SPOLINK_AUTH_E2E_DB_URL"]
  delete process.env["SPOLINK_AUTH_E2E_DB_URL"]
  try {
    await cleanupLiveAuthUser("fixture-address-is-not-logged")
  } finally {
    if (previous === undefined) delete process.env["SPOLINK_AUTH_E2E_DB_URL"]
    else process.env["SPOLINK_AUTH_E2E_DB_URL"] = previous
  }
})

test("fixture: each invocation reuses shared credentials with exact profile input", () => {
  const testInfo = {
    project: { name: "focused-project" },
    titlePath: ["focused-suite", "focused-case"],
  }

  const first = createSignupJourneyFixture(testInfo, "journey")
  const second = createSignupJourneyFixture(testInfo, "journey")

  assert.notEqual(first.email, second.email)
  assert.match(first.email, /@spolink\.test$/u)
  assert.equal(first.password, testPassword)
  assert.deepEqual(first.profile, expectedProfile)
})

test("profile assertion: matching auth identity and every persisted field pass", () => {
  assert.doesNotThrow(() => {
    assertPersistedSignupProfile(matchingProbe(), "synthetic-auth-user-a", expectedProfile)
  })
})

test("profile assertion: missing profile rejects with a stable redacted error", () => {
  assert.throws(
    () => assertPersistedSignupProfile(null, "synthetic-auth-user-a", expectedProfile),
    (error) => {
      assert.equal(error instanceof SignupProfileAssertionError, true)
      assert.equal(error.message, "Persisted signup profile did not match the expected contract.")
      assert.equal(error.message.includes("synthetic-auth-user-a"), false)
      return true
    },
  )
})

test("profile assertion: mismatched auth user id rejects without identifiers", () => {
  const probe = { ...matchingProbe(), profileId: "synthetic-auth-user-b" }

  assert.throws(
    () => assertPersistedSignupProfile(probe, "synthetic-auth-user-a", expectedProfile),
    (error) => {
      assert.equal(error instanceof SignupProfileAssertionError, true)
      assert.equal(error.message, "Persisted signup profile did not match the expected contract.")
      assert.equal(error.message.includes("synthetic-auth-user-a"), false)
      assert.equal(error.message.includes("synthetic-auth-user-b"), false)
      return true
    },
  )
})

test("profile assertion: missing or invalid required consent timestamp rejects", () => {
  for (const locationAgreedAt of [null, "not-a-timestamp"]) {
    assert.throws(
      () =>
        assertPersistedSignupProfile(
          { ...matchingProbe(), locationAgreedAt },
          "synthetic-auth-user-a",
          expectedProfile,
        ),
      SignupProfileAssertionError,
    )
  }
})

test("profile assertion: unexpected optional consent timestamp rejects", () => {
  assert.throws(
    () =>
      assertPersistedSignupProfile(
        { ...matchingProbe(), marketingAgreedAt: "2026-08-05T01:02:03.000Z" },
        "synthetic-auth-user-a",
        expectedProfile,
      ),
    SignupProfileAssertionError,
  )
})

test("browser collector: reports deterministic console, page, and request categories only", () => {
  const listeners = new Map()
  const page = {
    on(event, listener) {
      listeners.set(event, listener)
      return page
    },
  }
  const collector = attachBrowserFailureCollector(page)

  listeners.get("console")({ type: () => "warning" })
  listeners.get("console")({ type: () => "error", text: () => "sensitive console detail" })
  listeners.get("pageerror")(new Error("sensitive page detail"))
  listeners.get("requestfailed")({ url: () => "http://example.test/sensitive" })

  assert.deepEqual(collector.summary(), {
    consoleErrors: 1,
    pageErrors: 1,
    requestFailures: 1,
  })
})

test("cleanup: forced primary failure still invokes cleanup", async () => {
  let cleanupCalls = 0

  await assert.rejects(
    runWithSignupCleanup(
      "fixture-address-is-not-logged",
      async () => {
        throw new Error("primary detail is not logged")
      },
      async () => {
        cleanupCalls += 1
      },
    ),
    SignupCleanupError,
  )
  assert.equal(cleanupCalls, 1)
})

test("cleanup: primary and cleanup failures aggregate without sensitive details", async () => {
  await assert.rejects(
    runWithSignupCleanup(
      "fixture-address-is-not-logged",
      async () => {
        throw new TypeError("synthetic-auth-user-a")
      },
      async () => {
        throw new RangeError("synthetic-auth-user-b")
      },
    ),
    (error) => {
      assert.equal(error instanceof SignupCleanupError, true)
      assert.equal(error.message, "Signup journey failed and cleanup did not complete.")
      assert.equal(error.primaryFailureName, "TypeError")
      assert.equal(error.cleanupFailureName, "RangeError")
      assert.equal(error.message.includes("synthetic-auth-user"), false)
      return true
    },
  )
})
