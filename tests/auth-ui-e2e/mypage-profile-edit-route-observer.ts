import type { Page } from "@playwright/test"
import type { ObservedPatch } from "./mypage-profile-edit-page"
import { parseObservedPatch } from "./mypage-profile-edit-page"
import type { watchUnexpectedRuntimeFailures } from "./mypage-profile-edit-runtime-watcher"

type RuntimeWatcher = ReturnType<typeof watchUnexpectedRuntimeFailures>

export async function observeProfileEditPatchRoute({
  observedFailures,
  observedPatches,
  page,
  runtimeWatcher,
}: Readonly<{
  observedFailures: string[]
  observedPatches: ObservedPatch[]
  page: Page
  runtimeWatcher: RuntimeWatcher
}>): Promise<void> {
  let submission = 0
  let injectedFailure = 0

  page.on("request", (request) => {
    const url = new URL(request.url())
    if (url.pathname === "/api/me") runtimeWatcher.failures.apiMeRequests += 1
  })
  await page.route("**/api/profiles/me", async (route) => {
    submission += 1
    observedPatches.push(parseObservedPatch(route.request()))
    if (submission === 1) {
      const response = await route.fetch()
      await route.fulfill({ response })
      return
    }
    if (submission === 2) {
      injectedFailure += 1
      observedFailures.push("server-500")
      runtimeWatcher.expectInjectedProfileFailure(route.request(), "server-500", injectedFailure)
      await route.fulfill({
        body: JSON.stringify({
          error: { code: "INTERNAL_ERROR", message: "retryable", statusCode: 500 },
        }),
        contentType: "application/json",
        status: 500,
      })
      return
    }
    if (submission === 3) {
      injectedFailure += 1
      observedFailures.push("network-abort")
      runtimeWatcher.expectInjectedProfileFailure(route.request(), "network-abort", injectedFailure)
      await route.abort("failed")
      return
    }
    const response = await route.fetch()
    await route.fulfill({ response })
  })
}
