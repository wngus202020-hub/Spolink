import { createHash } from "node:crypto"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export const projects = ["mobile-chromium", "tablet-chromium", "desktop-chromium"]
export const reviewSpec = "tests/auth-ui-e2e/mypage-reviews.spec.ts"
export const sourceFiles = [
  reviewSpec,
  "tests/auth-ui-e2e/mypage-reviews-fixtures.ts",
  "tests/auth-ui-e2e/mypage-reviews-assertions.ts",
  "tests/auth-ui-e2e/mypage-reviews-scenario.ts",
  "tests/auth-ui-e2e/mypage-reviews-visual-scenario.ts",
  "tests/auth-ui-e2e/mypage-reviews-visual-dom.ts",
  "tests/auth-ui-e2e/mypage-reviews-visual-evidence.mjs",
  "tests/auth-ui-e2e/mypage-reviews-png.mjs",
  "tests/auth-ui-e2e/mypage-reviews-evidence.mjs",
  "tests/auth-ui-e2e/run-mypage-reviews.mjs",
  "tests/auth-ui-e2e/mypage-reviews-runner.test.mjs",
  "tests/auth-ui-e2e/mypage-reviews-runner-contract-helpers.mjs",
  "tests/auth-ui-e2e/mypage-reviews-runner-finalize.mjs",
  "tests/auth-ui-e2e/mypage-reviews-visual-runner.test.mjs",
]

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

export async function sourceManifest(repoRoot = process.cwd()) {
  return Promise.all(
    sourceFiles.map(async (file) => ({
      file,
      sha256: sha256(await readFile(path.join(repoRoot, file))),
    })),
  )
}

export async function readProjectReceipts(directory) {
  return Promise.all(
    projects.map(async (project) => {
      const receipt = JSON.parse(
        await readFile(path.join(directory, `mypage-reviews-${project}.json`), "utf8"),
      )
      if (receipt.project !== project || receipt.cleanup?.verdict !== "APPROVE") {
        throw new Error(`Invalid review receipt for ${project}.`)
      }
      return receipt
    }),
  )
}

export function allCountersAreZero(receipts) {
  return (
    receipts.length === projects.length &&
    receipts.every((receipt) =>
      Object.values(receipt.cleanup.cleanupCounters).every((count) => count === 0),
    )
  )
}

export function assertNoSensitiveEvidence(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  const forbidden = [
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu,
    /(?:postgres(?:ql)?):\/\/[^\s"']+/iu,
    /(?:Bearer\s+|eyJ)[A-Za-z0-9._-]+/u,
    /sb_(?:publishable|secret)_[A-Za-z0-9_-]+/u,
    /(?:password|cookie|serviceRoleKey|DB_URL)\s*[=:]/iu,
  ]
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new Error("Sensitive material detected in review evidence.")
  }
}

export function redactDiagnostic(value) {
  return value
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu,
      "[REDACTED_ID]",
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[REDACTED_EMAIL]")
    .replace(/(?:postgres(?:ql)?):\/\/[^\s"']+/giu, "[REDACTED_DB_URL]")
    .replace(/(?:Bearer\s+|eyJ)[A-Za-z0-9._-]+/gu, "[REDACTED_TOKEN]")
    .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/gu, "[REDACTED_KEY]")
    .replace(/SpolinkAuth1!/gu, "[REDACTED_PASSWORD]")
}

export async function writeMode600Json(filePath, value) {
  assertNoSensitiveEvidence(value)
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await chmod(filePath, 0o600)
}
