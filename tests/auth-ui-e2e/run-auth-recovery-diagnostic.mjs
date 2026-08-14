#!/usr/bin/env node
import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { withConfiguredAuthMode } from "./lifecycle.mjs"
import { buildChildEnv, runBuffered, sha256, writeJsonMode600 } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

const spec = "tests/auth-ui-e2e/auth-recovery-diagnostic.spec.ts"
const diagnosticPrefix = "RECOVERY_BOUNDARY_DIAGNOSTIC_REDACTED "

async function main() {
  const evidenceDir =
    process.argv[2] ?? path.join(".omo/evidence", "todo5-recovery-boundary-diagnostic")
  const outputPath = path.join(evidenceDir, "diagnostic.json")
  const reportPath = path.join(evidenceDir, "report.md")
  const rawOutput = await prepareRawPlaywrightOutputDir({
    retain: false,
    suppliedDir: process.env["SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR"] ?? null,
  })
  try {
    const summary = await withConfiguredAuthMode(
      { enableConfirmations: false },
      async ({ baseUrl, status }) => {
        const result = await runBuffered(
          "corepack",
          [
            "pnpm",
            "exec",
            "playwright",
            "test",
            "--config=playwright.auth.config.ts",
            spec,
            "--project=desktop-chromium",
          ],
          {
            env: buildChildEnv(process.env, {
              NODE_ENV: "test",
              SPOLINK_AUTH_E2E_BASE_URL: baseUrl,
              SPOLINK_AUTH_E2E_DB_URL: status.dbUrl,
              SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: rawOutput.dir,
            }),
          },
        )
        const redactedFailureOutput =
          result.exitCode === 0 ? null : await writeRedactedFailureOutput(outputPath, result)
        return {
          diagnostic: readDiagnostic(result.stdout),
          exitCode: result.exitCode,
          rawOutputDeleted: !rawOutput.retained,
          redactedFailureOutput,
          resultHash: sha256(`${result.stdout}${result.stderr}`),
          signal: result.signal,
          spec,
        }
      },
    )
    const verdict = summary.exitCode === 0 && summary.diagnostic ? "RECORDED" : "FAILED"
    const payload = { ...summary, schemaVersion: 1, verdict }
    await writeJsonMode600(outputPath, payload)
    await writeMode600(reportPath, renderReport(payload))
    if (verdict !== "RECORDED") process.exitCode = 1
  } finally {
    await rawOutput.cleanup()
  }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

function readDiagnostic(stdout) {
  const line = stdout.split(/\r?\n/u).find((entry) => entry.includes(diagnosticPrefix))
  if (!line) return null
  const value = line.slice(line.indexOf(diagnosticPrefix) + diagnosticPrefix.length)
  const parsed = JSON.parse(value)
  return isDiagnostic(parsed) ? parsed : null
}

function isDiagnostic(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    (typeof value.directRpcData === "boolean" || value.directRpcData === null) &&
    typeof value.directRpcError === "object" &&
    typeof value.markerCookiePresent === "boolean" &&
    Number.isInteger(value.authCookieCount) &&
    typeof value.browserUserMatches === "boolean" &&
    typeof value.browserSessionMatches === "boolean" &&
    Number.isInteger(value.routeStatus) &&
    (typeof value.routeErrorCode === "string" || value.routeErrorCode === null) &&
    typeof value.grantActiveAfter === "boolean" &&
    typeof value.grantConsumedAfter === "boolean"
  )
}

function renderReport(payload) {
  const diagnostic = payload.diagnostic
  const rows = diagnostic
    ? [
        [
          "directRpcData/error",
          `${diagnostic.directRpcData}/${diagnostic.directRpcError.messageClass}`,
        ],
        [
          "markerCookiePresent/authCookieCount",
          `${diagnostic.markerCookiePresent}/${diagnostic.authCookieCount}`,
        ],
        [
          "browserUserMatches/browserSessionMatches",
          `${diagnostic.browserUserMatches}/${diagnostic.browserSessionMatches}`,
        ],
        ["routeStatus/errorCode", `${diagnostic.routeStatus}/${diagnostic.routeErrorCode}`],
        [
          "grantActiveAfter/grantConsumedAfter",
          `${diagnostic.grantActiveAfter}/${diagnostic.grantConsumedAfter}`,
        ],
      ]
    : [
        ["directRpcData/error", "not-recorded/not-recorded"],
        ["markerCookiePresent/authCookieCount", "not-recorded/not-recorded"],
        ["browserUserMatches/browserSessionMatches", "not-recorded/not-recorded"],
        ["routeStatus/errorCode", "not-recorded/not-recorded"],
        ["grantActiveAfter/grantConsumedAfter", "not-recorded/not-recorded"],
      ]
  return [
    "# Todo 5 Recovery Boundary Diagnostic",
    "",
    `Verdict: ${payload.verdict}`,
    `Spec: ${payload.spec}`,
    `Exit code: ${payload.exitCode}`,
    `Raw Playwright output deleted: ${payload.rawOutputDeleted}`,
    "",
    "| Boundary | Redacted observable |",
    "|---|---|",
    ...rows.map(([key, value]) => `| ${key} | ${value} |`),
    "",
  ].join("\n")
}

async function writeMode600(filePath, content) {
  await mkdir(path.dirname(filePath), { mode: 0o700, recursive: true })
  await writeFile(filePath, content, { mode: 0o600 })
  await chmod(filePath, 0o600)
}

async function writeRedactedFailureOutput(outputPath, result) {
  const basePath = outputPath.replace(/\.json$/u, "")
  const stdoutPath = `${basePath}.stdout.redacted.log`
  const stderrPath = `${basePath}.stderr.redacted.log`
  await Promise.all([
    writeMode600(stdoutPath, redactOutput(result.stdout)),
    writeMode600(stderrPath, redactOutput(result.stderr)),
  ])
  return {
    stderrPath,
    stderrSha256: sha256(await redactedText(result.stderr)),
    stdoutPath,
    stdoutSha256: sha256(await redactedText(result.stdout)),
  }
}

async function redactedText(value) {
  return redactOutput(value)
}

function redactOutput(value) {
  return value
    .replace(/\b[A-Za-z0-9._%+-]+@spolink\.test\b/giu, "<redacted-email>")
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "<redacted-jwt>")
    .replace(/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+\b/gu, "<redacted-supabase-key>")
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/giu, "<redacted-postgres-url>")
    .replace(/(^|[^\w-])((?:set-)?cookie)\s*:\s*[^\r\n]*/giu, "$1$2: <redacted>")
    .replace(/(^|[^\w-])(authorization)\s*:\s*[^\r\n]*/giu, "$1$2: <redacted>")
}
