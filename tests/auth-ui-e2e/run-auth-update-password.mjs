#!/usr/bin/env node
import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { withConfiguredAuthMode } from "./lifecycle.mjs"
import { buildChildEnv, runBuffered, sha256, writeJsonMode600 } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

const spec = "tests/auth-ui-e2e/auth-update-password.spec.ts"
const submitResponsePrefix = "SUBMIT_RESPONSE_REDACTED "

function readProjects(args) {
  const projects = args.filter((arg) => arg.startsWith("--project="))
  return projects.length > 0
    ? projects
    : ["--project=desktop-chromium", "--project=mobile-chromium"]
}

function readPlaywrightArgs(args) {
  return args.filter((arg) => !arg.startsWith("--project="))
}

async function main() {
  const [
    outputPath = path.join(".omo/evidence", "todo5-auth-update-password-summary.json"),
    ...args
  ] = process.argv.slice(2)
  const rawOutput = await prepareRawPlaywrightOutputDir({
    retain: process.env["SPOLINK_AUTH_E2E_RETAIN_RAW_OUTPUT"] === "1",
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
            ...readProjects(args),
            ...readPlaywrightArgs(args),
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
          exitCode: result.exitCode,
          rawOutputDirRetained: rawOutput.retained ? rawOutput.dir : null,
          resultHash: sha256(`${result.stdout}${result.stderr}`),
          redactedFailureOutput,
          signal: result.signal,
          spec,
          submitResponses: readSubmitResponseCaptures(result.stdout),
        }
      },
    )
    const verdict = summary.exitCode === 0 ? "APPROVE" : "REJECT"
    await writeJsonMode600(outputPath, { ...summary, schemaVersion: 1, verdict })
    if (verdict !== "APPROVE") process.exitCode = 1
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

async function writeMode600(filePath, content) {
  await mkdir(path.dirname(filePath), { mode: 0o700, recursive: true })
  await writeFile(filePath, content, { mode: 0o600 })
  await chmod(filePath, 0o600)
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

function readSubmitResponseCaptures(stdout) {
  return stdout
    .split(/\r?\n/u)
    .filter((line) => line.includes(submitResponsePrefix))
    .map((line) => parseSubmitCapture(line.slice(line.indexOf(submitResponsePrefix))))
    .filter((capture) => capture !== null)
}

function parseSubmitCapture(line) {
  const value = line.slice(submitResponsePrefix.length)
  try {
    const parsed = JSON.parse(value)
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      Number.isInteger(parsed.status) &&
      (typeof parsed.errorCode === "string" || parsed.errorCode === null)
    ) {
      return { errorCode: parsed.errorCode, status: parsed.status }
    }
  } catch {
    return null
  }
  return null
}
