import assert from "node:assert/strict"
import test from "node:test"

import { authSignupJourneyTitlesByMode, finalQaProjects } from "./contracts.mjs"
import { buildChildEnv, runBuffered } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

test("signup journey mode contract maps each confirmation state to a distinct title", () => {
  // Given: the machine-consumed runner mode map.
  const entries = Object.entries(authSignupJourneyTitlesByMode)

  // When: both supported confirmation modes are resolved.
  const modes = entries.map(([mode]) => mode)
  const titles = entries.map(([, title]) => title)

  // Then: each mode selects one stable, unique journey registration.
  assert.deepEqual(modes, ["false", "true"])
  assert.equal(new Set(titles).size, 2)
  assert.equal(
    titles.every((title) => typeof title === "string" && title.length > 0),
    true,
  )
})

test("canonical final QA module registers both signup journeys for desktop and mobile", async () => {
  // Given: Playwright's real module-registration path with an owned external output directory.
  const rawOutput = await prepareRawPlaywrightOutputDir({ retain: false, suppliedDir: null })
  try {
    // When: Playwright loads and lists the canonical final-QA module without launching a browser.
    const result = await runBuffered(
      "corepack",
      [
        "pnpm",
        "exec",
        "playwright",
        "test",
        "--list",
        "--config=playwright.auth.config.ts",
        "tests/auth-ui-e2e/final-qa.spec.ts",
        "--project=desktop-chromium",
        "--project=mobile-chromium",
      ],
      {
        env: buildChildEnv(process.env, {
          SPOLINK_AUTH_E2E_CONFIRMATIONS: "false",
          SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: rawOutput.dir,
        }),
        timeoutMs: 30_000,
      },
    )

    // Then: every configured project exposes every mode-mapped journey title.
    assert.equal(result.exitCode, 0, result.stderr)
    for (const project of finalQaProjects) {
      for (const title of Object.values(authSignupJourneyTitlesByMode)) {
        assert.match(result.stdout, new RegExp(`\\[${project}\\].*${escapeRegex(title)}`, "u"))
      }
    }
  } finally {
    await rawOutput.cleanup()
  }
})

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}
