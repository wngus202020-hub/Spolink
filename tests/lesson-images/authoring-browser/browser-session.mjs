import { chromium } from "@playwright/test"

import { baseUrl } from "./constants.mjs"

export function createRuntimeReceipt() {
  return {
    abortedRequests: [],
    consoleErrors: [],
    expectedNetworkConsoleErrors: [],
    failedRequests: [],
    pageErrors: [],
    responses: [],
  }
}

export async function openAuthoringBrowser() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: { height: 800, width: 1280 },
  })
  context.setDefaultTimeout(15_000)
  context.setDefaultNavigationTimeout(15_000)
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
  return { browser, context, page: await context.newPage() }
}
