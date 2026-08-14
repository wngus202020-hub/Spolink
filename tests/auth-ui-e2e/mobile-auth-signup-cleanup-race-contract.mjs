import { createHash, randomUUID } from "node:crypto"
import { lstat, readFile } from "node:fs/promises"

import { resolveEvidenceChildPath } from "./evidence-paths.mjs"

export const mobileAuthSourcePaths = Object.freeze([
  "playwright.auth.config.ts",
  "scripts/supabase-local/lifecycle.mjs",
  "scripts/supabase-local/lock.mjs",
  "tests/auth-ui-e2e/contracts.mjs",
  "tests/auth-ui-e2e/evidence-paths.mjs",
  "tests/auth-ui-e2e/lifecycle.mjs",
  "tests/auth-ui-e2e/mobile-auth-signup-cleanup-race-contract.mjs",
  "tests/auth-ui-e2e/mobile-auth-signup-cleanup-race.test.mjs",
  "tests/auth-ui-e2e/mobile-auth-signup-cleanup-race-wrapper.test.mjs",
  "tests/auth-ui-e2e/process.mjs",
  "tests/auth-ui-e2e/raw-output.mjs",
  "tests/auth-ui-e2e/run-auth-forms.mjs",
  "tests/auth-ui-e2e/run-mobile-auth-signup-cleanup-race.mjs",
  "tests/auth-ui-e2e/run.mjs",
  "tests/auth-ui-e2e/runner-failure.mjs",
  "tests/auth-ui-e2e/runner-redaction.test.mjs",
  "tests/auth-ui-e2e/signup-onboarding-login-browser.ts",
  "tests/auth-ui-e2e/signup-onboarding-login-contract.test.mjs",
  "tests/auth-ui-e2e/signup-onboarding-login-helpers.test.mjs",
  "tests/auth-ui-e2e/signup-onboarding-login-helpers.ts",
  "tests/auth-ui-e2e/signup-onboarding-login.spec.ts",
  "tests/auth-ui-e2e/verify-source-inventory.mjs",
  "tests/supabase-local-guard/ownership.test.mjs",
])

export const sourceInventoryAllowedPaths = Object.freeze([
  ".omo/plans/mobile-auth-signup-cleanup-race.md",
  ".omo/evidence/mobile-auth-signup-cleanup-race",
  "scripts/supabase-local/lifecycle.mjs",
  "scripts/supabase-local/lock.mjs",
  ...mobileAuthSourcePaths,
  "supabase/config.toml",
  "tests/auth-ui-e2e/fake-lifecycle-harness.mjs",
  "tests/auth-ui-e2e/lifecycle-failures.test.mjs",
])

export const sourceInventoryAllowedModifiedPaths = Object.freeze([
  ".omo/plans/mobile-auth-signup-cleanup-race.md",
  "scripts/supabase-local/lifecycle.mjs",
  "scripts/supabase-local/lock.mjs",
  "supabase/config.toml",
  "tests/auth-ui-e2e/fake-lifecycle-harness.mjs",
  "tests/auth-ui-e2e/lifecycle.mjs",
  "tests/auth-ui-e2e/lifecycle-failures.test.mjs",
  "tests/auth-ui-e2e/mobile-auth-signup-cleanup-race-contract.mjs",
  "tests/auth-ui-e2e/mobile-auth-signup-cleanup-race.test.mjs",
  "tests/auth-ui-e2e/mobile-auth-signup-cleanup-race-wrapper.test.mjs",
  "tests/auth-ui-e2e/process.mjs",
  "tests/auth-ui-e2e/run-auth-forms.mjs",
  "tests/auth-ui-e2e/run-mobile-auth-signup-cleanup-race.mjs",
  "tests/auth-ui-e2e/run.mjs",
  "tests/auth-ui-e2e/runner-redaction.test.mjs",
  "tests/auth-ui-e2e/signup-onboarding-login-browser.ts",
  "tests/auth-ui-e2e/signup-onboarding-login.spec.ts",
  "tests/auth-ui-e2e/verify-source-inventory.mjs",
  "tests/supabase-local-guard/ownership.test.mjs",
])

export const supersededTodo1SourceInventoryBaselinePath =
  ".omo/evidence/mobile-auth-signup-cleanup-race/20260810T112458199Z-ff322538-edce-4e00-8f9c-24b922184ba5/source-inventory.json"

export const supersededTodo4SourceInventoryBaselinePath =
  ".omo/evidence/mobile-auth-signup-cleanup-race/todo4-reconcile-20260810T145448Z/source-inventory-full-baseline.json"

export const sourceInventoryBaselinePath =
  ".omo/evidence/mobile-auth-signup-cleanup-race/todo5-baseline-20260810T160625Z/source-inventory-full-baseline.json"

const sensitiveEvidencePattern =
  /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|Bearer\s|eyJ[A-Za-z0-9_-]+\.|password|phone|cookie|token|postgres(?:ql)?:\/\/|sb_(?:publishable|secret)_)/iu

export function createMobileAuthRunId() {
  return randomUUID()
}

export function defaultMobileAuthReceiptPath(runId, now = new Date()) {
  if (typeof runId !== "string" || !/^[0-9a-f-]{36}$/u.test(runId)) {
    throw new Error("Auth UI runId must be a UUID")
  }
  const timestamp = now.toISOString().replaceAll(/[-:.]/gu, "")
  return `.omo/evidence/mobile-auth-signup-cleanup-race/${timestamp}-${runId}/canonical-runner.json`
}

export async function computeMobileAuthSourceHash(repoRoot = process.cwd()) {
  const hash = createHash("sha256")
  for (const sourcePath of mobileAuthSourcePaths) {
    hash.update(sourcePath)
    hash.update("\0")
    hash.update(await readFile(`${repoRoot}/${sourcePath}`))
    hash.update("\n")
  }
  return hash.digest("hex")
}

export async function resolveMobileAuthReceiptPath(inputPath, repoRoot = process.cwd()) {
  const receiptPath = await resolveEvidenceChildPath(inputPath, {
    createParent: true,
    kind: "file",
    repoRoot,
    suffix: ".json",
  })
  try {
    await lstat(receiptPath)
    throw new Error("Auth UI receipt path must be fresh")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return receiptPath
    throw error
  }
}

export function assertRedactedMobileAuthReceipt(receipt) {
  const serialized = JSON.stringify(receipt)
  if (sensitiveEvidencePattern.test(serialized)) {
    throw new Error("Auth UI receipt contains sensitive content")
  }
}

export function mobileAuthJourneyPassed(
  journey,
  enableConfirmations,
  allowInjectedProfileAbort = false,
) {
  return (
    journey.status === "passed" &&
    journey.signupStatus === 200 &&
    journey.signupSessionPresent === !enableConfirmations &&
    (allowInjectedProfileAbort ? journey.profileStatus === null : journey.profileStatus === 201) &&
    journey.profilePersisted &&
    journey.identityMatched &&
    journey.navigationPathname === "/lessons" &&
    journey.requestSummary?.pendingRequests === 0 &&
    journey.requestSummary?.unexpectedFailures === 0 &&
    journey.requestSummary?.profileAborts === (allowInjectedProfileAbort ? 1 : 0) &&
    (!allowInjectedProfileAbort || journey.requestSummary?.expectedFailures === 1) &&
    journey.cleanup.authUserDeleted &&
    (!enableConfirmations || journey.cleanup.mailpitMessageDeleted)
  )
}

export function readMobileAuthJourneyResults(stdout, title, projects) {
  let report = null
  try {
    report = JSON.parse(stdout)
  } catch {
    return projects.map((project) => missingJourney(project))
  }
  const observed = collectTests(report)
  return projects.map((project) => {
    const match = observed.find((item) => item.project === project && item.testTitle === title)
    if (!match) return missingJourney(project)
    return Object.fromEntries(Object.entries(match).filter(([key]) => key !== "testTitle"))
  })
}

export const mobileAuthReceiptMode = 0o600

function collectTests(report) {
  if (!report || !Array.isArray(report.suites)) return []
  return report.suites.flatMap((suite) => collectSuiteTests(suite))
}

function collectSuiteTests(suite) {
  const tests = Array.isArray(suite.specs)
    ? suite.specs.flatMap((spec) => collectSpecTests(spec))
    : []
  const childTests = Array.isArray(suite.suites)
    ? suite.suites.flatMap((child) => collectSuiteTests(child))
    : []
  return [...tests, ...childTests]
}

function collectSpecTests(spec) {
  if (!Array.isArray(spec.tests)) return []
  return spec.tests.map((testCase) => {
    const result = testCase.results?.[0]
    const manualQa = readReceipt(result, "manual-qa")
    const mailpitDeleted = readReceipt(result, "mailpit-cleanup")?.["messageDeleted"] === true
    const cleanupOrder = manualQa?.["cleanupOrder"] ?? []
    return {
      browserSummary: manualQa?.["browserSummary"] ?? null,
      cleanup: {
        authUserDeleted: readReceipt(result, "cleanup")?.["authUserDeleted"] === true,
        mailpitMessageDeleted: mailpitDeleted || manualQa?.["mailpitMessageDeleted"] === true,
        order:
          mailpitDeleted && !cleanupOrder.includes("mailpit-message")
            ? ["mailpit-message", ...cleanupOrder]
            : cleanupOrder,
      },
      identityMatched: manualQa?.["authProfileIdentityMatched"] === true,
      navigationPathname: manualQa?.["profileNavigationPathname"] ?? null,
      network: manualQa?.["network"] ?? null,
      profilePersisted: manualQa?.["dbProfileVerified"] === true,
      profileStatus: manualQa?.["profileStatus"] ?? null,
      project: typeof testCase.projectName === "string" ? testCase.projectName : "unknown",
      requestSummary: manualQa?.["requestSummary"] ?? null,
      signupSessionPresent: manualQa?.["signupSessionPresent"] ?? null,
      signupStatus: manualQa?.["signupStatus"] ?? null,
      status: result?.status ?? "missing",
      testTitle: spec.title,
      viewport:
        testCase.projectName === "mobile-chromium"
          ? { height: 844, width: 390 }
          : { height: 800, width: 1280 },
    }
  })
}

function readReceipt(result, event) {
  if (!Array.isArray(result?.stdout)) return null
  for (const entry of result.stdout) {
    try {
      const receipt = JSON.parse(entry?.text ?? "")
      if (receipt?.event === event) return receipt
    } catch {
      // Ignore non-JSON Playwright output while locating structured receipts.
    }
  }
  return null
}

function missingJourney(project) {
  return {
    browserSummary: null,
    cleanup: { authUserDeleted: false, mailpitMessageDeleted: false, order: [] },
    identityMatched: false,
    navigationPathname: null,
    network: null,
    profilePersisted: false,
    profileStatus: null,
    project,
    requestSummary: null,
    signupSessionPresent: null,
    signupStatus: null,
    status: "missing",
    viewport:
      project === "mobile-chromium" ? { height: 844, width: 390 } : { height: 800, width: 1280 },
  }
}
