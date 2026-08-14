#!/usr/bin/env node
import { pathToFileURL } from "node:url"

import { finalQaHypotheses, finalQaProjects, finalQaScenarioNames } from "./contracts.mjs"
import { withConfiguredAuthMode } from "./lifecycle.mjs"
import { buildChildEnv, runBuffered, sha256, writeJsonMode600 } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

async function main() {
  const [outputPath] = process.argv.slice(2)
  if (!outputPath) throw new Error("usage: node tests/auth-ui-e2e/run-final-qa.mjs <output-path>")
  const rawOutput = await prepareRawPlaywrightOutputDir({
    retain: process.env["SPOLINK_AUTH_E2E_RETAIN_RAW_OUTPUT"] === "1",
    suppliedDir: process.env["SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR"] ?? null,
  })
  try {
    const result = await withConfiguredAuthMode(
      { enableConfirmations: true },
      async ({ baseUrl, status }) =>
        runBuffered(
          "corepack",
          [
            "pnpm",
            "exec",
            "playwright",
            "test",
            "--config=playwright.auth.config.ts",
            "tests/auth-ui-e2e/final-qa.spec.ts",
            "--project=desktop-chromium",
            "--project=mobile-chromium",
            "--reporter=json",
          ],
          {
            env: buildChildEnv(process.env, {
              NODE_ENV: "test",
              SPOLINK_AUTH_E2E_API_URL: status.apiUrl,
              SPOLINK_AUTH_E2E_BASE_URL: baseUrl,
              SPOLINK_AUTH_E2E_CONFIRMATIONS: "true",
              SPOLINK_AUTH_E2E_DB_URL: status.dbUrl,
              ...(process.env["SPOLINK_AUTH_E2E_INJECT_FAILURE"]
                ? {
                    SPOLINK_AUTH_E2E_INJECT_FAILURE: process.env["SPOLINK_AUTH_E2E_INJECT_FAILURE"],
                  }
                : {}),
              SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: rawOutput.dir,
            }),
          },
        ),
    )
    const verdict = await writeFinalQaSummary(outputPath, result)
    if (verdict !== "APPROVE") process.exitCode = 1
  } finally {
    await rawOutput.cleanup()
  }
}

export async function writeFinalQaSummary(outputPath, result) {
  const report = parsePlaywrightReport(result.stdout)
  const summary = buildSummary(result, report)
  const verdict = summaryIsApproved(summary) ? "APPROVE" : "REJECT"
  await writeJsonMode600(outputPath, {
    hypotheses: summary.hypotheses.map((item) => ({
      name: item.name,
      project: item.project,
      resultHash: item.resultHash,
      status: item.status,
      verdict: item.verdict,
    })),
    scenarios: summary.scenarios,
    consoleErrorCount: summary.runtimeObserved ? 0 : null,
    networkFailureCount: summary.runtimeObserved ? 0 : null,
    cleanup: {
      command: "run-final-qa local Playwright child cleanup",
      proofSha256: sha256(`${result.signal ?? "none"}:${result.exitCode}`),
      verdict: result.signal === null ? "APPROVE" : "REJECT",
    },
    missing: summary.missing,
    parseError: summary.parseError,
    runtimeObserved: summary.runtimeObserved,
    verdict,
  })
  return verdict
}

function parsePlaywrightReport(stdout) {
  try {
    return { report: JSON.parse(stdout), parseError: null }
  } catch (error) {
    return {
      parseError: error instanceof Error ? error.message : String(error),
      report: null,
    }
  }
}

function buildSummary(result, parsed) {
  const observedTests = collectTests(parsed.report)
  const scenarios = expectedScenarioRows(observedTests)
  const hypotheses = expectedHypothesisRows(observedTests)
  const missing = [
    ...scenarios.filter((item) => item.status === "missing").map((item) => item.title),
    ...hypotheses.filter((item) => item.status === "missing").map((item) => item.title),
  ].sort()
  return {
    hypotheses,
    missing,
    parseError: parsed.parseError,
    runtimeObserved:
      result.exitCode === 0 &&
      parsed.parseError === null &&
      missing.length === 0 &&
      [...scenarios, ...hypotheses].every((item) => item.status === "passed"),
    scenarios,
  }
}

function expectedScenarioRows(observedTests) {
  return finalQaProjects.flatMap((project) =>
    finalQaScenarioNames.map((name) =>
      expectedRow({
        kind: "scenario",
        name,
        observedTests,
        project,
        title: `${name} scenario is owned by auth final QA`,
      }),
    ),
  )
}

function expectedHypothesisRows(observedTests) {
  return finalQaProjects.flatMap((project) =>
    finalQaHypotheses.map((name) =>
      expectedRow({
        kind: "hypothesis",
        name,
        observedTests,
        project,
        title: `${name} runtime hypothesis is proved by auth final QA`,
      }),
    ),
  )
}

function expectedRow({ kind, name, observedTests, project, title }) {
  const observed = observedTests.find((item) => item.project === project && item.title === title)
  const status = observed?.status ?? "missing"
  return {
    kind,
    name,
    project,
    resultHash: sha256(JSON.stringify(observed ?? { project, title })),
    status,
    title,
    verdict: status === "passed" ? "APPROVE" : "REJECT",
  }
}

function collectTests(report) {
  if (!report || !Array.isArray(report.suites)) return []
  return report.suites.flatMap((suite) => collectSuiteTests(suite, []))
}

function collectSuiteTests(suite, titlePath) {
  const nextTitlePath = [...titlePath, suite.title].filter(Boolean)
  const tests = Array.isArray(suite.specs)
    ? suite.specs.flatMap((spec) => collectSpecTests(spec, nextTitlePath))
    : []
  const childTests = Array.isArray(suite.suites)
    ? suite.suites.flatMap((child) => collectSuiteTests(child, nextTitlePath))
    : []
  return [...tests, ...childTests]
}

function collectSpecTests(spec, titlePath) {
  if (!Array.isArray(spec.tests)) return []
  return spec.tests.map((testCase) => {
    const project = typeof testCase.projectName === "string" ? testCase.projectName : "unknown"
    const status = testCase.results?.[0]?.status ?? "missing"
    return {
      project,
      status,
      title: [...titlePath, spec.title].filter(Boolean).at(-1) ?? spec.title,
    }
  })
}

function summaryIsApproved(summary) {
  return (
    summary.parseError === null &&
    summary.runtimeObserved &&
    summary.missing.length === 0 &&
    summary.scenarios.every((item) => item.verdict === "APPROVE") &&
    summary.hypotheses.every((item) => item.verdict === "APPROVE")
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
