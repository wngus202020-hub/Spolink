import { expect, test } from "@playwright/test"

const routes = [
  { name: "home", path: "/" },
  { name: "lessons", path: "/lessons" },
] as const

for (const route of routes) {
  test(`direction alignment smoke ${route.path}`, async ({ page }, testInfo) => {
    // Given: runtime failures on the current app route are observed before navigation.
    const consoleErrors: string[] = []
    const failedAppRequests: string[] = []
    const pageErrors: string[] = []
    const appOrigin = new URL(testInfo.project.use.baseURL ?? "http://127.0.0.1").origin

    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text())
    })
    page.on("pageerror", (error) => pageErrors.push(error.message))
    page.on("requestfailed", (request) => {
      if (
        new URL(request.url()).origin === appOrigin &&
        request.failure()?.errorText !== "net::ERR_ABORTED"
      ) {
        failedAppRequests.push(request.url())
      }
    })
    page.on("response", (response) => {
      if (new URL(response.url()).origin === appOrigin && response.status() >= 400) {
        failedAppRequests.push(response.url())
      }
    })

    const injectRouteAbort = process.env["SPOLINK_DIRECTION_INJECT_ROUTE_ABORT"] === route.name
    if (injectRouteAbort) {
      await page.route(`**${route.path}`, (requestRoute) => requestRoute.abort("failed"))
    }

    // When: a user loads the route and tabs once.
    try {
      await page.goto(route.path, { waitUntil: "networkidle" })
    } catch (error) {
      if (!(injectRouteAbort && error instanceof Error)) throw error
    }
    await page.evaluate(() => document.fonts.ready)
    if (process.env["SPOLINK_DIRECTION_INJECT_OVERFLOW"] === route.name) {
      await page.evaluate(() => {
        const probe = document.createElement("div")
        probe.style.cssText = "display:block;width:calc(100vw + 1px);height:1px;pointer-events:none"
        document.body.append(probe)
      })
    }
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }),
    )
    await page.keyboard.press("Tab")

    const focusEscaped = await page.evaluate(() => {
      const active = document.activeElement
      return (
        active === null ||
        active === document.body ||
        active === document.documentElement ||
        !active.isConnected ||
        !document.body.contains(active)
      )
    })
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    // Then: every shared runtime/layout/focus assertion is clean.
    expect(pageErrors, "page errors").toEqual([])
    expect(consoleErrors, "unexpected console errors").toEqual([])
    expect(failedAppRequests, "failed app requests").toEqual([])
    expect(horizontalOverflow, "horizontal overflow pixels").toBeLessThanOrEqual(0)
    expect(focusEscaped, "keyboard focus escaped the document").toBe(false)
  })
}
