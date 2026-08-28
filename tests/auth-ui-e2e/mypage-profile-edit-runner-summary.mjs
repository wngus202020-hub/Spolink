import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

export const profileEditSpec = "tests/auth-ui-e2e/mypage-profile-edit.spec.ts"
export const projects = ["desktop-chromium", "tablet-chromium", "mobile-chromium"]
export const expectedTitles = [
  "profile edit auth redirects cover unauthenticated, profile-required, and restricted users",
  "null legacy region requires canonical reselection and first-error focus",
  "profile edit journey saves changed-only fields and persists after retry",
]

export async function readLastRunVerdict(rawOutputDir, { sha256 }) {
  try {
    const text = await readFile(path.join(rawOutputDir, ".last-run.json"), "utf8")
    const parsed = JSON.parse(text)
    const failedTestCount = Array.isArray(parsed.failedTests) ? parsed.failedTests.length : null
    const passed = parsed.status === "passed" && failedTestCount === 0
    return {
      failedTestCount,
      statusHash: sha256(String(parsed.status)),
      verdict: passed ? "APPROVE" : "REJECT",
    }
  } catch (error) {
    return {
      errorHash: sha256(error instanceof Error ? error.message : String(error)),
      verdict: "REJECT",
    }
  }
}

export async function readRawOutputInventoryVerdict(rawOutputDir, { sha256 }) {
  try {
    const entries = (await readdir(rawOutputDir)).sort()
    return {
      entryCount: entries.length,
      inventoryHash: sha256(JSON.stringify(entries)),
      verdict: entries.length === 1 && entries[0] === ".last-run.json" ? "APPROVE" : "REJECT",
    }
  } catch (error) {
    return {
      errorHash: sha256(error instanceof Error ? error.message : String(error)),
      verdict: "REJECT",
    }
  }
}

export function retainedRawOutputLabel(rawOutput) {
  if (!rawOutput.retained) return null
  return process.env["SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR"]
    ? "<caller-supplied>"
    : "<runner-owned-retained>"
}

export function isApproved(summary) {
  return (
    summary.exitCode === 0 &&
    summary.signal === null &&
    summary.lastRun.verdict === "APPROVE" &&
    summary.outputInventory.verdict === "APPROVE" &&
    summary.playwrightReport.verdict === "APPROVE" &&
    summary.rawOutputCleanupStatus === "APPROVE" &&
    summary.runErrorHash === null &&
    summary.supabaseTempCleanup.verdict === "APPROVE" &&
    summary.supabaseTempCleanupErrorHash === null &&
    summary.visual.verdict === "APPROVE" &&
    (summary.visualPublication.verdict === "PENDING" ||
      summary.visualPublication.verdict === "APPROVE")
  )
}
