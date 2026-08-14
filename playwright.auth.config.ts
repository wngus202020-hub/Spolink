import { defineConfig, devices } from "@playwright/test"

const baseURL = process.env["SPOLINK_AUTH_E2E_BASE_URL"] ?? "http://127.0.0.1:3006"
const outputDir = process.env["SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR"]

if (!outputDir) {
  throw new Error("SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR must name an external 0700 temp dir.")
}

if (outputDir.includes(".omo/evidence")) {
  throw new Error("Raw Playwright output must not be written under .omo/evidence.")
}

export default defineConfig({
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  outputDir,
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { height: 800, width: 1280 },
      },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 5"],
        viewport: { height: 844, width: 390 },
      },
    },
    {
      name: "tablet-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { height: 1024, width: 768 },
      },
    },
  ],
  reporter: [["list"]],
  testDir: "./tests/auth-ui-e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "off",
  },
  workers: 1,
})
