import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { register } from "node:module"
import os from "node:os"
import path from "node:path"
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

const {
  attachSignupRequestCollector,
  isExpectedNavigationAbort,
  readPositiveDelayMs,
  readSignupSessionPresent,
  waitForProfileCreateSettlement,
} = await import("./signup-onboarding-login-browser.ts")
const {
  assertRedactedMobileAuthReceipt,
  computeMobileAuthSourceHash,
  createMobileAuthRunId,
  readMobileAuthJourneyResults,
  resolveMobileAuthReceiptPath,
} = await import("./mobile-auth-signup-cleanup-race-contract.mjs")

test("baseline: framework navigation abort remains classified as expected", () => {
  // Given: an unchanged framework request canceled by navigation.
  const failure = { errorText: "net::ERR_ABORTED", path: "/_next/static/chunk.js" }

  // When: the existing navigation-abort classifier evaluates it.
  const expected = isExpectedNavigationAbort(failure)

  // Then: the existing framework-abort behavior remains accepted.
  assert.equal(expected, true)
})

test("profile abort is unexpected unless the abort is explicitly injected", () => {
  // Given: the mobile profile failure observed before Todo 1 changes.
  const failure = { errorText: "net::ERR_ABORTED", path: "/api/profiles" }

  // When: normal and explicitly injected classifications are evaluated.
  const normalExpected = isExpectedNavigationAbort(failure)
  const injectedExpected = isExpectedNavigationAbort(failure, true)

  // Then: only the explicit fault-injection path accepts the abort.
  assert.equal(normalExpected, false)
  assert.equal(injectedExpected, true)
})

test("injected profile abort is the only counted expected failure", () => {
  // Given: one injected profile abort plus benign framework navigation aborts.
  const listeners = new Map()
  const page = {
    on(event, listener) {
      listeners.set(event, listener)
      return page
    },
  }
  const collector = attachSignupRequestCollector(page, true)
  const failedRequest = (path) => ({
    failure: () => ({ errorText: "net::ERR_ABORTED" }),
    method: () => "POST",
    url: () => `http://127.0.0.1:3000${path}`,
  })

  // When: the collector observes the injected abort and unrelated accepted aborts.
  for (const path of ["/api/profiles", "/api/me", "/_next/static/chunk.js"]) {
    listeners.get("requestfailed")(failedRequest(path))
  }

  // Then: only the injected profile abort is counted, with no unexpected failures.
  assert.deepEqual(collector.summary(), {
    expectedFailures: 1,
    pendingRequests: 0,
    profileAborts: 1,
    totalFailures: 3,
    unexpectedFailures: 0,
  })
})

test("injected profile abort awaits request failure instead of an impossible response", async () => {
  // Given: an injected profile request that is aborted by navigation after server settlement.
  const request = {
    failure: () => ({ errorText: "net::ERR_ABORTED" }),
    method: () => "POST",
    url: () => "http://127.0.0.1:3000/api/profiles",
  }
  const page = {
    waitForEvent(event, options) {
      assert.equal(event, "requestfailed")
      assert.equal(options.predicate(request), true)
      return Promise.resolve(request)
    },
    waitForResponse() {
      throw new Error("Injected abort must not await a profile response.")
    },
  }

  // When: the profile settlement wait is selected for the injected path.
  const settlement = await waitForProfileCreateSettlement(page, true)

  // Then: the request failure is the terminal expected outcome.
  assert.deepEqual(settlement, { errorText: "net::ERR_ABORTED", kind: "injected-abort" })
})

test("normal profile creation awaits a strict 201 response", async () => {
  // Given: a normal profile create response and no injected navigation abort.
  const response = { status: () => 201 }
  const page = {
    waitForEvent() {
      throw new Error("Normal profile creation must not await request failure.")
    },
    waitForResponse(predicate) {
      assert.equal(
        predicate({
          request: () => ({
            method: () => "POST",
            url: () => "http://127.0.0.1:3000/api/profiles",
          }),
          url: () => "http://127.0.0.1:3000/api/profiles",
        }),
        true,
      )
      return Promise.resolve(response)
    },
  }

  // When: the profile settlement wait is selected for the normal path.
  const settlement = await waitForProfileCreateSettlement(page, false)

  // Then: the response status is preserved for the strict journey assertion.
  assert.deepEqual(settlement, { kind: "response", status: 201 })
})

test("canonical runner propagates a positive profile delay to a real injected navigation abort", async () => {
  // Given: the canonical runner and browser journey are the only supported control boundary.
  const runner = await readFile("tests/auth-ui-e2e/run.mjs", "utf8")
  const spec = await readFile("tests/auth-ui-e2e/signup-onboarding-login.spec.ts", "utf8")

  // When/Then: delay is forwarded and the browser journey owns a controlled post-settlement abort.
  assert.equal(runner.includes("SPOLINK_AUTH_E2E_PROFILE_DELAY_MS"), true)
  assert.equal(spec.includes("installProfileResponseControl"), true)
  assert.equal(spec.includes("await profileControl.injectNavigationAbort(page)"), true)
})

test("profile delay control rejects malformed and non-positive input", () => {
  // Given/When/Then: only an absent value or a safe positive integer crosses the test boundary.
  assert.equal(readPositiveDelayMs(undefined), null)
  assert.equal(readPositiveDelayMs("2500"), 2500)
  for (const malformed of ["", "0", "-1", "2.5", "abc", "9007199254740992"]) {
    assert.throws(() => readPositiveDelayMs(malformed), /must be/u)
  }
})

test("confirmation-off signup recognizes the real root credential response as a session", () => {
  // Given: the redacted structure observed in the retained real-browser trace.
  const signupResponse = {
    access_token: "synthetic-access-value",
    refresh_token: "synthetic-refresh-value",
    user: { id: "synthetic-user" },
  }

  // When/Then: root credentials represent the immediate confirmation-off session.
  assert.equal(readSignupSessionPresent(signupResponse), true)
})

test("canonical runner requires one explicit fresh JSON receipt path", async () => {
  // Given: the canonical runner source at its CLI boundary.
  const source = await readFile("tests/auth-ui-e2e/run.mjs", "utf8")

  // When: its output-path contract is inspected.
  const consumesArgument = source.includes("process.argv[2]")
  const usesFreshReceiptResolver = source.includes("resolveMobileAuthReceiptPath")
  const hasSafeDefaultReceipt = source.includes("defaultMobileAuthReceiptPath(runId)")

  // Then: package-script invocation gets a fresh safe default while explicit stale paths stay rejected.
  assert.equal(consumesArgument, true)
  assert.equal(usesFreshReceiptResolver, true)
  assert.equal(hasSafeDefaultReceipt, true)
  assert.equal(source.includes("resolveAuthOutputDir"), false)
})

test("receipt contract owns fresh run identity, source hash, redaction, and mode 0600", async () => {
  // Given: the Todo 1 evidence-contract module.
  const source = await readFile(
    "tests/auth-ui-e2e/mobile-auth-signup-cleanup-race-contract.mjs",
    "utf8",
  )
  const runner = await readFile("tests/auth-ui-e2e/run.mjs", "utf8")
  const implementation = `${source}\n${runner}`

  // When: its machine-consumed contract is inspected.
  const requiredTokens = [
    "randomUUID",
    "sourceHash",
    "0o600",
    "assertRedactedMobileAuthReceipt",
    "mobileAuthSourcePaths",
  ]

  // Then: each required evidence invariant has an implementation seam.
  for (const token of requiredTokens) assert.equal(implementation.includes(token), true, token)
})

test("receipt path rejects traversal and an existing stale target", async () => {
  // Given: an isolated repository evidence root and an already-used receipt path.
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-mobile-auth-receipt-"))
  const relativePath = ".omo/evidence/mobile-auth/fresh.json"
  try {
    await mkdir(path.join(repoRoot, ".omo", "evidence"), { mode: 0o700, recursive: true })
    await assert.rejects(
      resolveMobileAuthReceiptPath(".omo/evidence/../escaped.json", repoRoot),
      /must not escape/u,
    )
    const receiptPath = await resolveMobileAuthReceiptPath(relativePath, repoRoot)
    await writeFile(receiptPath, "{}\n", { mode: 0o600 })

    // When/Then: reusing the path is rejected as stale state.
    await assert.rejects(resolveMobileAuthReceiptPath(relativePath, repoRoot), /must be fresh/u)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("run identity is fresh, source inventory is hash-backed, and sensitive receipts reject", async () => {
  // Given/When: two run identities and the current source inventory hash are generated.
  const firstRunId = createMobileAuthRunId()
  const secondRunId = createMobileAuthRunId()
  const sourceHash = await computeMobileAuthSourceHash()

  // Then: stale identity reuse and unhashed source claims are impossible.
  assert.notEqual(firstRunId, secondRunId)
  assert.match(firstRunId, /^[0-9a-f-]{36}$/u)
  assert.match(sourceHash, /^[a-f0-9]{64}$/u)
  assert.throws(
    () => assertRedactedMobileAuthReceipt({ contact: "fixture@spolink.test" }),
    /sensitive content/u,
  )
})

test("failed journey receipt preserves request and exact cleanup observations", () => {
  // Given: a failed Playwright result with structured, redacted stdout receipts.
  const stdout = [
    { text: JSON.stringify({ authUserDeleted: true, event: "cleanup" }) },
    { text: JSON.stringify({ event: "mailpit-cleanup", messageDeleted: true }) },
    {
      text: JSON.stringify({
        cleanupOrder: ["auth-user"],
        event: "manual-qa",
        requestSummary: { pendingRequests: 0, profileAborts: 1, unexpectedFailures: 1 },
      }),
    },
  ]
  const report = {
    suites: [
      {
        specs: [
          {
            tests: [{ projectName: "mobile-chromium", results: [{ status: "failed", stdout }] }],
            title: "synthetic journey",
          },
        ],
      },
    ],
  }

  // When: the runner extracts the failed journey.
  const [journey] = readMobileAuthJourneyResults(JSON.stringify(report), "synthetic journey", [
    "mobile-chromium",
  ])

  // Then: product failure and exact cleanup remain independently observable.
  assert.equal(journey.requestSummary.profileAborts, 1)
  assert.deepEqual(journey.cleanup, {
    authUserDeleted: true,
    mailpitMessageDeleted: true,
    order: ["mailpit-message", "auth-user"],
  })
})
