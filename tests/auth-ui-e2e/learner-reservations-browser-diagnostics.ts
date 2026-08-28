import type { ConsoleMessage, Page, Request, Response } from "@playwright/test"

const expectedHttpFailures = [
  { routeCategory: "completion-page", status: 404 },
  { routeCategory: "reservation-detail-page", status: 404 },
] as const

type RouteCategory =
  | "completion-page"
  | "calendar-download"
  | "external"
  | "other-app-route"
  | "page"
  | "reservation-detail-page"

export type BrowserDiagnosticsReceipt = Readonly<{
  consoleWarningCount: number
  expectedHttpFailures: readonly Readonly<{
    count: number
    routeCategory: (typeof expectedHttpFailures)[number]["routeCategory"]
    status: 404
  }>[]
  expectedNavigationAbortCount: number
  unexpected: Readonly<{
    consoleError: number
    httpResponse: number
    pageError: number
    requestFailed: number
  }>
}>

type BrowserDiagnosticsCollector = Readonly<{
  finish: () => BrowserDiagnosticsReceipt
}>

export class UnexpectedBrowserDiagnosticsError extends Error {
  constructor() {
    super("Unexpected browser diagnostics were recorded")
    this.name = "UnexpectedBrowserDiagnosticsError"
  }
}

export function attachLearnerReservationBrowserDiagnostics(
  page: Page,
  expectedOrigin: string,
): BrowserDiagnosticsCollector {
  const origin = new URL(expectedOrigin).origin
  const expectedHttpCounts = new Map<string, number>()
  let consoleErrorCount = 0
  let consoleWarningCount = 0
  let expectedNavigationAbortCount = 0
  let pageErrorCount = 0
  let requestFailedCount = 0
  let unexpectedHttpCount = 0
  let finishedReceipt: BrowserDiagnosticsReceipt | null = null

  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === "warning") consoleWarningCount += 1
    if (message.type() === "error" && !isExpectedNotFoundConsole(message, origin)) {
      consoleErrorCount += 1
    }
  }
  const onPageError = () => {
    pageErrorCount += 1
  }
  const onRequestFailed = (request: Request) => {
    if (isExpectedCalendarDownloadAbort(request, origin)) expectedNavigationAbortCount += 1
    else requestFailedCount += 1
  }
  const onResponse = (response: Response) => {
    const status = response.status()
    if (status < 400) return
    const routeCategory = classifyRoute(response.url(), origin)
    const expected = expectedHttpFailures.find(
      (failure) => failure.routeCategory === routeCategory && failure.status === status,
    )
    if (expected) {
      const key = `${expected.routeCategory}:${expected.status}`
      expectedHttpCounts.set(key, (expectedHttpCounts.get(key) ?? 0) + 1)
    } else unexpectedHttpCount += 1
  }

  page.on("console", onConsole)
  page.on("pageerror", onPageError)
  page.on("requestfailed", onRequestFailed)
  page.on("response", onResponse)

  return {
    finish: () => {
      if (finishedReceipt !== null) return finishedReceipt
      page.off("console", onConsole)
      page.off("pageerror", onPageError)
      page.off("requestfailed", onRequestFailed)
      page.off("response", onResponse)
      finishedReceipt = Object.freeze({
        consoleWarningCount,
        expectedHttpFailures: expectedHttpFailures.map((failure) => ({
          count: expectedHttpCounts.get(`${failure.routeCategory}:${failure.status}`) ?? 0,
          ...failure,
        })),
        expectedNavigationAbortCount,
        unexpected: Object.freeze({
          consoleError: consoleErrorCount,
          httpResponse: unexpectedHttpCount,
          pageError: pageErrorCount,
          requestFailed: requestFailedCount,
        }),
      })
      return finishedReceipt
    },
  }
}

export function assertBrowserDiagnosticsClean(receipt: BrowserDiagnosticsReceipt): void {
  if (Object.values(receipt.unexpected).some((count) => count > 0)) {
    throw new UnexpectedBrowserDiagnosticsError()
  }
}

function isExpectedNotFoundConsole(message: ConsoleMessage, expectedOrigin: string): boolean {
  const locationUrl = message.location().url
  if (!/^Failed to load resource:.*404/iu.test(message.text()) || !locationUrl) return false
  const routeCategory = classifyRoute(locationUrl, expectedOrigin)
  return expectedHttpFailures.some((failure) => failure.routeCategory === routeCategory)
}

function isExpectedCalendarDownloadAbort(request: Request, expectedOrigin: string): boolean {
  return (
    classifyRoute(request.url(), expectedOrigin) === "calendar-download" &&
    request.method() === "GET" &&
    request.isNavigationRequest() &&
    request.resourceType() === "document" &&
    request.failure()?.errorText === "net::ERR_ABORTED"
  )
}

function classifyRoute(urlValue: string, expectedOrigin: string): RouteCategory {
  const url = new URL(urlValue)
  if (url.origin !== expectedOrigin) return "external"
  if (/^\/api\/reservations\/[^/]+\/calendar$/u.test(url.pathname)) return "calendar-download"
  if (/^\/reservations\/[^/]+\/complete$/u.test(url.pathname)) return "completion-page"
  if (/^\/mypage\/reservations\/[^/]+$/u.test(url.pathname)) {
    return "reservation-detail-page"
  }
  return "other-app-route"
}
