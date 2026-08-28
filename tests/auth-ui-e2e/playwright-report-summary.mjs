import { createHash } from "node:crypto"

export function readPlaywrightErrorCount(stdout) {
  const report = parseReport(stdout)
  return Array.isArray(report?.errors) ? report.errors.length : 0
}

export function readPlaywrightScenarios(stdout) {
  const report = parseReport(stdout)
  return Array.isArray(report?.suites) ? report.suites.flatMap(readSuiteScenarios) : []
}

function readSuiteScenarios(suite) {
  if (typeof suite !== "object" || suite === null) return []
  const specs = Array.isArray(suite.specs)
    ? suite.specs.map((item) => ({
        failures:
          item.tests?.flatMap((test) =>
            (test.results ?? []).flatMap((result) =>
              (result.errors ?? []).map((error) => ({
                column: error.location?.column ?? null,
                line: error.location?.line ?? null,
                messageSha256: sha256(error.message ?? ""),
              })),
            ),
          ) ?? [],
        tests: item.tests?.map((test) => ({ status: test.status })) ?? [],
        title: item.title,
      }))
    : []
  const nested = Array.isArray(suite.suites) ? suite.suites.flatMap(readSuiteScenarios) : []
  return [...specs, ...nested]
}

function parseReport(stdout) {
  try {
    return JSON.parse(stdout)
  } catch {
    return null
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
