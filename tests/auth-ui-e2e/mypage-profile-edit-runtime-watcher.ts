import type { ConsoleMessage, Page, Request, Response } from "@playwright/test"

type ExpectedInjectedFailureType = "network-abort" | "server-500"

export type ProfileEditRuntimeFailures = Readonly<{
  apiMeRequests: number
  consoleErrors: string[]
  requestFailures: string[]
  responseFailures: string[]
}>

export type ExpectedInjectedFailureReceipt = Readonly<{
  consoleObserved: boolean
  method: "PATCH"
  observed: boolean
  ordinal: number
  path: "/api/profiles/me"
  type: ExpectedInjectedFailureType
}>

export function expectedProfileEditInjectedFailureReceipts(): ExpectedInjectedFailureReceipt[] {
  return [
    {
      consoleObserved: true,
      method: "PATCH",
      observed: true,
      ordinal: 1,
      path: "/api/profiles/me",
      type: "server-500",
    },
    {
      consoleObserved: true,
      method: "PATCH",
      observed: true,
      ordinal: 2,
      path: "/api/profiles/me",
      type: "network-abort",
    },
  ]
}

type ExpectedInjectedFailure = {
  consoleObserved: boolean
  readonly method: "PATCH"
  observed: boolean
  readonly ordinal: number
  readonly path: "/api/profiles/me"
  readonly request: Request
  readonly type: ExpectedInjectedFailureType
}

export function watchUnexpectedRuntimeFailures(page: Page) {
  const failures = createRuntimeFailures()
  const expectedInjectedFailures: ExpectedInjectedFailure[] = []
  let navigationAbortScopes = 0
  let observedNavigationAborts = 0

  page.on("console", (message) => {
    if (message.type() !== "error") return
    if (consumeExpectedInjectedConsole(expectedInjectedFailures, message.text())) return
    if (isExpectedNavigationAbortConsole(message, navigationAbortScopes)) return
    failures.consoleErrors.push(message.text().slice(0, 120))
  })
  page.on("requestfailed", (request) => {
    const url = new URL(request.url())
    if (consumeExpectedInjectedFailure(expectedInjectedFailures, request, "network-abort", url)) {
      return
    }
    if (isExpectedSamePageNavigationAbort(request, url, navigationAbortScopes)) {
      observedNavigationAborts += 1
      return
    }
    failures.requestFailures.push(`${request.method()} ${url.pathname}`)
  })
  page.on("response", (response) => {
    const url = new URL(response.url())
    if (consumeExpectedInjectedResponse(expectedInjectedFailures, response, url)) return
    if (url.pathname.startsWith("/api/") && response.status() >= 400) {
      failures.responseFailures.push(`${response.status()} ${url.pathname}`)
    }
  })

  return {
    beginExpectedSamePageNavigationAbort() {
      navigationAbortScopes += 1
      return {
        end() {
          navigationAbortScopes = Math.max(0, navigationAbortScopes - 1)
        },
      }
    },
    expectInjectedProfileFailure(
      request: Request,
      type: ExpectedInjectedFailureType,
      ordinal: number,
    ) {
      if (expectedInjectedFailures.some((entry) => entry.ordinal === ordinal)) {
        throw new Error("Duplicate injected profile failure ordinal.")
      }
      expectedInjectedFailures.push({
        method: "PATCH",
        consoleObserved: false,
        observed: false,
        ordinal,
        path: "/api/profiles/me",
        request,
        type,
      })
    },
    failures,
    observedExpectedInjectedFailures() {
      return expectedInjectedFailures.map(
        ({ consoleObserved, method, observed, ordinal, path, type }) => ({
          consoleObserved,
          method,
          observed,
          ordinal,
          path,
          type,
        }),
      )
    },
    observedNavigationAborts() {
      return observedNavigationAborts
    },
  }
}

function consumeExpectedInjectedConsole(
  expectedFailures: ExpectedInjectedFailure[],
  text: string,
): boolean {
  const expected = expectedFailures.find((entry) => !entry.consoleObserved)
  if (!expected?.observed || text !== expectedInjectedConsoleMessage(expected.type)) return false
  expected.consoleObserved = true
  return true
}

function expectedInjectedConsoleMessage(type: ExpectedInjectedFailureType): string {
  return type === "server-500"
    ? "Failed to load resource: the server responded with a status of 500 (Internal Server Error)"
    : "Failed to load resource: net::ERR_FAILED"
}

function createRuntimeFailures(): {
  apiMeRequests: number
  consoleErrors: string[]
  requestFailures: string[]
  responseFailures: string[]
} {
  return {
    apiMeRequests: 0,
    consoleErrors: [],
    requestFailures: [],
    responseFailures: [],
  }
}

function consumeExpectedInjectedResponse(
  expectedFailures: ExpectedInjectedFailure[],
  response: Response,
  url: URL,
): boolean {
  if (response.status() !== 500) return false
  return consumeExpectedInjectedFailure(expectedFailures, response.request(), "server-500", url)
}

function consumeExpectedInjectedFailure(
  expectedFailures: ExpectedInjectedFailure[],
  request: Request,
  type: ExpectedInjectedFailureType,
  url: URL,
): boolean {
  const expected = expectedFailures.find((entry) => !entry.observed)
  if (
    !expected ||
    expected.request !== request ||
    expected.type !== type ||
    request.method() !== expected.method ||
    url.pathname !== expected.path
  ) {
    return false
  }
  expected.observed = true
  return true
}

function isExpectedSamePageNavigationAbort(
  request: Request,
  url: URL,
  activeScopes: number,
): boolean {
  return (
    activeScopes > 0 &&
    request.method() === "GET" &&
    url.pathname === "/mypage/profile" &&
    request.resourceType() === "document" &&
    normalizeChromiumAbortText(request.failure()?.errorText ?? "") === "net::ERR_ABORTED"
  )
}

function isExpectedNavigationAbortConsole(message: ConsoleMessage, activeScopes: number): boolean {
  return (
    activeScopes > 0 &&
    message.text() === "Failed to load resource: net::ERR_ABORTED" &&
    message.type() === "error"
  )
}

function normalizeChromiumAbortText(value: string): "net::ERR_ABORTED" | "other" {
  return value === "net::ERR_ABORTED" || value === "net::ERR_ABORTED; maybe frame was detached"
    ? "net::ERR_ABORTED"
    : "other"
}
