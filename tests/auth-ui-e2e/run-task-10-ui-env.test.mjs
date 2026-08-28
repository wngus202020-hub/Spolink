import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { readPlaywrightErrorCount, readPlaywrightScenarios } from "./playwright-report-summary.mjs"

test("task-10 runner passes guarded local fixture configuration to Playwright", async () => {
  const source = await readFile("tests/auth-ui-e2e/run-task-10-ui.mjs", "utf8")

  assert.match(source, /async \(\{ baseUrl, lifecycle, status \}\)/u)
  assert.match(source, /SPOLINK_AUTH_E2E_API_URL: status\.apiUrl/u)
  assert.match(source, /SPOLINK_AUTH_E2E_ANON_KEY: status\.anonKey/u)
  assert.match(source, /SPOLINK_AUTH_E2E_DB_URL: status\.dbUrl/u)
  assert.match(source, /SPOLINK_AUTH_E2E_SERVICE_ROLE_KEY: status\.serviceRoleKey/u)
})

test("task-10 lifecycle enables only the bounded admin operations UI gates", async () => {
  const [runner, lifecycle, child] = await Promise.all(
    [
      "tests/auth-ui-e2e/run-task-10-ui.mjs",
      "tests/auth-ui-e2e/lifecycle.mjs",
      "tests/auth-ui-e2e/lifecycle-child.mjs",
    ].map((filePath) => readFile(filePath, "utf8")),
  )

  assert.match(runner, /enableAdminOperationsUiFixtures: true/u)
  assert.match(lifecycle, /options\.enableAdminOperationsUiFixtures === true/u)
  assert.match(child, /enableAdminOperationsUiFixtures/u)
  assert.match(child, /SPOLINK_AUTH_E2E_ADMIN_RESERVATION_STATE: "enabled"/u)
  assert.match(child, /SPOLINK_AUTH_E2E_ADMIN_DASHBOARD_STATE: "enabled"/u)
})

test("dashboard capture records CSS viewport pixels", async () => {
  const source = await readFile("tests/auth-ui-e2e/admin-dashboard-assertions.ts", "utf8")

  assert.match(source, /scale:\s*"css"/u)
})

test("task-10 evidence includes nested Playwright scenario statuses", () => {
  const report = JSON.stringify({
    errors: [{ message: "redacted global error" }],
    suites: [
      {
        specs: [{ tests: [{ results: [], status: "expected" }], title: "direct" }],
        suites: [
          {
            specs: [
              {
                tests: [
                  {
                    results: [
                      {
                        errors: [
                          {
                            location: { column: 7, line: 228 },
                            message: "Expected stale response status 409",
                          },
                        ],
                      },
                    ],
                    status: "unexpected",
                  },
                ],
                title: "nested",
              },
            ],
          },
        ],
      },
    ],
  })

  assert.deepEqual(readPlaywrightScenarios(report), [
    { failures: [], tests: [{ status: "expected" }], title: "direct" },
    {
      failures: [
        {
          column: 7,
          line: 228,
          messageSha256: "4aea02dfff5031f0cd28c25b8b7d8705047d82275a9a109cf2bf95207af9a1fe",
        },
      ],
      tests: [{ status: "unexpected" }],
      title: "nested",
    },
  ])
  assert.equal(readPlaywrightErrorCount(report), 1)
})
