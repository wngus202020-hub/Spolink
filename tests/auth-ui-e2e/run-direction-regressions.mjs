#!/usr/bin/env node
import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeRedactedJson } from "../supabase-e2e/evidence-redaction.mjs"
import {
  buildChildEnv,
  runBuffered,
  sha256,
  stopActiveCommand,
  trackActiveCommand,
} from "./process.mjs"

process.umask(0o077)
const normalizedTestUmaskModule = "data:text/javascript,process.umask(0o022)"
const repoRoot = process.cwd()
let activeCommand = null
let checkoutRoot = null
let tempRoot = null
let shuttingDown = false

async function main() {
  const [outputPath, ...extra] = process.argv.slice(2)
  if (!outputPath || extra.length > 0) {
    throw new Error(
      "usage: node tests/auth-ui-e2e/run-direction-regressions.mjs <output-summary-path>",
    )
  }
  const before3000 = await capturePort3000()
  let api = null
  let auth = null
  let authSummary = null
  let orchestrationError = null
  let removedTempRoot = null
  const injection = process.env["SPOLINK_DIRECTION_REGRESSION_INJECT_FAILURE"] ?? ""

  try {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-direction-regressions-"))
    removedTempRoot = tempRoot
    checkoutRoot = path.join(tempRoot, "workspace")
    await mkdir(checkoutRoot, { mode: 0o700 })
    await copyWorkspace(checkoutRoot)
    await serializeApiTests(checkoutRoot)
    await normalizeCopiedLifecycleDiagnostics(checkoutRoot)
    await mkdir(path.join(checkoutRoot, ".omo/evidence"), { mode: 0o700, recursive: true })
    await symlink(
      path.join(repoRoot, "node_modules"),
      path.join(checkoutRoot, "node_modules"),
      "dir",
    )
    const authSummaryPath = path.join(tempRoot, "auth-forms.json")
    api = await runChild("tests/auth-ui-e2e/run-api-tests.mjs", [], {
      NODE_OPTIONS: "--test-reporter-destination=stderr",
      ...(injection === "api" ? { SPOLINK_TEST_BASE_URL: "http://example.invalid" } : {}),
    })
    auth = await runChild("tests/auth-ui-e2e/run-auth-forms.mjs", [authSummaryPath], {
      ...(injection === "auth" ? { SPOLINK_AUTH_E2E_INJECT_FAILURE: "after-next-ready" } : {}),
    })
    authSummary = await readOptional(authSummaryPath)
  } catch (error) {
    orchestrationError = error instanceof Error ? error : new Error(String(error))
  } finally {
    await stopActiveCommand(activeCommand)
    activeCommand = null
    if (tempRoot) await rm(tempRoot, { force: true, recursive: true })
    tempRoot = null
    checkoutRoot = null
  }

  const tempRootRemoved = removedTempRoot ? !(await pathExists(removedTempRoot)) : true
  const after3000 = await capturePort3000()
  const port3000Preserved = before3000 === after3000
  const verdict =
    !orchestrationError &&
    api?.exitCode === 0 &&
    auth?.exitCode === 0 &&
    authSummary?.verdict === "APPROVE" &&
    port3000Preserved &&
    tempRootRemoved
      ? "APPROVE"
      : "REJECT"
  const summary = {
    schemaVersion: 1,
    verdict,
    runs: [
      {
        name: "api-lifecycle",
        command: "node tests/auth-ui-e2e/run-api-tests.mjs",
        exitCode: api?.exitCode ?? null,
        signal: api?.signal ?? null,
        exitReason: childExitReason(api),
        outputSha256: childOutputSha256(api),
        diagnostics: childDiagnostics(api),
        coverage: verdictFor(api?.exitCode, ["profile:403", "profile:415", "profile:422"]),
      },
      {
        name: "auth-form-lifecycle",
        command: "node tests/auth-ui-e2e/run-auth-forms.mjs <external-redacted-summary>",
        exitCode: auth?.exitCode ?? null,
        signal: auth?.signal ?? null,
        exitReason: childExitReason(auth),
        outputSha256: childOutputSha256(auth),
        diagnostics: childDiagnostics(auth),
        summarySha256: authSummary ? sha256(JSON.stringify(authSummary)) : null,
        coverage: verdictFor(auth?.exitCode, ["reset:abort", "reset:500", "reset:retry"]),
      },
    ],
    cleanup: {
      exitCode: port3000Preserved && tempRootRemoved ? 0 : 1,
      port3000AfterSha256: sha256(after3000),
      port3000BeforeSha256: sha256(before3000),
      port3000Preserved,
      proofSha256: sha256(`${before3000}:${after3000}:${String(tempRootRemoved)}`),
      tempRootRemoved,
    },
    error: orchestrationError ? redactOutput(orchestrationError.message) : null,
  }
  const absoluteOutputPath = path.resolve(repoRoot, outputPath)
  await mkdir(path.dirname(absoluteOutputPath), { mode: 0o700, recursive: true })
  await writeRedactedJson(absoluteOutputPath, summary, [])
  if (verdict !== "APPROVE") process.exitCode = 1
  console.log(JSON.stringify({ summaryPath: outputPath, verdict }))
}

async function serializeApiTests(checkout) {
  const packagePath = path.join(checkout, "package.json")
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"))
  const expected =
    "node --test tests/*.test.mjs tests/profile-api/*.test.mjs tests/coach-certification/*.test.mjs tests/auth-ui-e2e/coach-applicant-runner.test.mjs"
  if (packageJson.scripts?.["test:api:contracts"] !== expected) {
    throw new Error(
      "Unexpected test:api:contracts command; refusing to change the regression policy",
    )
  }
  packageJson.scripts["test:api:contracts"] = expected.replace(
    "node --test",
    "node --test --test-concurrency=1",
  )
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, { mode: 0o600 })
}

async function normalizeCopiedLifecycleDiagnostics(checkout) {
  const lifecyclePath = path.join(checkout, "tests/auth-ui-e2e/lifecycle.mjs")
  const source = await readFile(lifecyclePath, "utf8")
  const original = 'import { spawn } from "node:child_process"'
  const instrumented = `${original}\n\nimport { redactText } from "../supabase-e2e/task8/process.mjs"`
  const expression = "$" + "{"
  const failure = `throw new Error(\`corepack pnpm test:api:contracts failed\\n${expression}result.stderr}\`)`
  const diagnosticFailure = `throw new Error(\`corepack pnpm test:api:contracts failed\\nstdout:\\n${expression}redactText(result.stdout)}\\nstderr:\\n${expression}redactText(result.stderr)}\`)`
  const readiness = "await waitForConfiguredState(reservation.baseUrl)"
  const routeUrl = `${expression}reservation.baseUrl}${expression}pathname}`
  const warmCopiedApiRoutes = `${readiness}\n    for (const pathname of ["/api/payments/prepare", "/api/reservations"]) {\n      const response = await fetch(\`${routeUrl}\`)\n      if (response.status !== 405) throw new Error(\`API warmup failed: ${expression}pathname}\`)\n      await response.arrayBuffer()\n    }`
  if (!source.includes(original) || !source.includes(failure) || !source.includes(readiness)) {
    throw new Error("Unexpected lifecycle diagnostics; refusing temporary instrumentation")
  }
  const normalized = source
    .replace(original, instrumented)
    .replace(failure, diagnosticFailure)
    .replace(readiness, warmCopiedApiRoutes)
  await writeFile(lifecyclePath, normalized, { mode: 0o600 })
}

async function runChild(script, args, additions) {
  return runBuffered(process.execPath, ["--import", normalizedTestUmaskModule, script, ...args], {
    cwd: checkoutRoot ?? repoRoot,
    env: buildChildEnv(process.env, additions),
    onChild: (child) => {
      activeCommand = trackActiveCommand(child)
    },
    timeoutMs: 600_000,
  }).finally(() => {
    activeCommand = null
  })
}

async function copyWorkspace(checkout) {
  const skipped = new Set([".codegraph", ".git", ".next", ".omo", "node_modules"])
  await cp(repoRoot, checkout, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(repoRoot, source)
      const isSupabaseRuntime =
        relative === "supabase/.branches" ||
        relative.startsWith(`supabase/.branches${path.sep}`) ||
        relative === "supabase/.temp" ||
        relative.startsWith(`supabase/.temp${path.sep}`)
      return (relative === "" || !skipped.has(relative.split(path.sep)[0])) && !isSupabaseRuntime
    },
  })
}

async function pathExists(filePath) {
  try {
    await lstat(filePath)
    return true
  } catch {
    return false
  }
}

async function readOptional(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"))
  } catch {
    return null
  }
}

function verdictFor(exitCode, names) {
  return names.map((name) => ({ name, verdict: exitCode === 0 ? "APPROVE" : "REJECT" }))
}

function childOutputSha256(result) {
  return result ? sha256(`${result.stdout}${result.stderr}`) : null
}

function childDiagnostics(result) {
  if (!result) return null
  return {
    stderrBytes: Buffer.byteLength(result.stderr),
    stderrSha256: sha256(result.stderr),
    stderrTail: redactOutput(result.stderr).slice(-8_000),
    stdoutBytes: Buffer.byteLength(result.stdout),
    stdoutSha256: sha256(result.stdout),
    stdoutTail: redactOutput(result.stdout).slice(-8_000),
  }
}

function childExitReason(result) {
  if (!result || result.exitCode === 0) return null
  const output = result.stderr.trim() || result.stdout.trim()
  if (!output) return `child exited ${result.exitCode}${result.signal ? ` (${result.signal})` : ""}`
  return redactOutput(output).slice(0, 2_000)
}

function redactOutput(value) {
  return value
    .replaceAll(repoRoot, "<repo>")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gu, "<redacted-email>")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
      "<redacted-uuid>",
    )
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "<redacted-jwt>")
    .replace(/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+\b/gu, "<redacted-key>")
    .replace(/\b(?:https?|postgres(?:ql)?):\/\/[^\s"'<>]+/giu, "<redacted-url>")
}

async function capturePort3000() {
  const result = await runBuffered("lsof", ["-nP", "-iTCP:3000", "-sTCP:LISTEN", "-t"], {
    timeoutMs: 10_000,
  })
  return result.stdout.trim() || "none"
}

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  await stopActiveCommand(activeCommand)
  if (tempRoot) await rm(tempRoot, { force: true, recursive: true })
  process.exit(signal === "SIGINT" ? 130 : 143)
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void shutdown(signal))

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
