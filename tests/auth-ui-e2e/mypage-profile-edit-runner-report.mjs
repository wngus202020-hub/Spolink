import { createHash } from "node:crypto"

export function summarizePlaywrightReport(stdout, { expectedTitles, projects }) {
  try {
    const report = JSON.parse(stdout)
    const tests = collectTests(report)
    const rows = projects.flatMap((project) =>
      expectedTitles.map((title) => {
        const match = tests.find(
          (testCase) => testCase.project === project && testCase.title === title,
        )
        return {
          errorCategory: classifyFailure(match),
          project,
          status: match?.status ?? "missing",
          step: classifyFailureStep(match),
          title,
        }
      }),
    )
    const skipped = tests.filter((testCase) => testCase.status === "skipped")
    const missing = rows.filter((row) => row.status === "missing")
    const failed = rows.filter((row) => row.status !== "passed")
    return {
      failedCount: failed.length,
      failureSummary: failed,
      missingCount: missing.length,
      observedCount: tests.length,
      perProject: projects.map((project) => ({
        passed: rows.filter((row) => row.project === project && row.status === "passed").length,
        project,
      })),
      skippedCount: skipped.length,
      verdict:
        failed.length === 0 && missing.length === 0 && skipped.length === 0 ? "APPROVE" : "REJECT",
    }
  } catch (error) {
    return {
      errorCategory: "malformed-report",
      errorHash: hashError(error),
      failureSummary: [],
      verdict: "REJECT",
    }
  }
}

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
    const firstResult = Array.isArray(testCase.results) ? testCase.results[0] : null
    return {
      errorText: readResultErrorText(firstResult),
      project: typeof testCase.projectName === "string" ? testCase.projectName : "unknown",
      status: firstResult?.status ?? "missing",
      title: spec.title,
    }
  })
}

function readResultErrorText(result) {
  if (!result) return ""
  if (typeof result.error?.message === "string") return result.error.message
  if (Array.isArray(result.errors)) {
    return result.errors
      .map((error) => (typeof error?.message === "string" ? error.message : ""))
      .join("\n")
  }
  return ""
}

function classifyFailure(testCase) {
  if (!testCase || testCase.status === "missing") return "missing"
  if (testCase.status === "passed") return null
  if (testCase.status === "skipped") return "skipped"
  const text = testCase.errorText.toLowerCase()
  if (testCase.status === "timedOut" || text.includes("timeout")) return "timeout"
  if (text.includes("expect(") || text.includes("expected")) return "assertion"
  if (text.includes("locator")) return "locator"
  if (text.includes("net::") || text.includes("requestfailed")) return "network"
  return "execution"
}

function classifyFailureStep(testCase) {
  if (!testCase || testCase.status === "missing") return "missing"
  if (testCase.status === "passed") return null
  if (testCase.status === "skipped") return "skipped"
  const text = testCase.errorText.toLowerCase()
  if (text.includes("runtimewatcher") || text.includes("consoleerrors")) return "runtime-watcher"
  if (text.includes("tohaveurl")) return "navigation-url"
  if (text.includes("tobedisabled")) return "save-disabled"
  if (text.includes("tobevisible")) return "visible-assertion"
  if (text.includes("toequal")) return "equality-assertion"
  if (text.includes("timeout")) return "timeout"
  return "execution"
}

function hashError(error) {
  return createHash("sha256")
    .update(error instanceof Error ? error.message : String(error))
    .digest("hex")
}
