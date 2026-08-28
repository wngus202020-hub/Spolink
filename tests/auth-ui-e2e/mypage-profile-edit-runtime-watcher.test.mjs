import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"
import { fileURLToPath } from "node:url"
import typescript from "typescript"
import {
  emptyFailures,
  FakePage,
  fakeConsole,
  fakeRequest,
  fakeResponse,
  networkAbortConsoleMessage,
  profileApiUrl,
  server500ConsoleMessage,
} from "./mypage-profile-edit-runtime-watcher-fixture.mjs"

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".ts")) return nextLoad(url, context)
    const loaded = nextLoad(url, { ...context, format: "module" })
    const source = typeof loaded.source === "string" ? loaded.source : loaded.source.toString()
    const result = typescript.transpileModule(source, {
      compilerOptions: {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ES2022,
      },
      fileName: fileURLToPath(url),
    })
    return { format: "module", shortCircuit: true, source: result.outputText }
  },
})

const { watchUnexpectedRuntimeFailures } = await import("./mypage-profile-edit-runtime-watcher.ts")

test("Given an unregistered profile API 500, watcher records the response failure", () => {
  const page = new FakePage()
  const watcher = watchUnexpectedRuntimeFailures(page)
  const request = fakeRequest({
    method: "PATCH",
    resourceType: "fetch",
    url: "http://127.0.0.1:3000/api/profiles/me",
  })

  page.emit("response", fakeResponse({ request, status: 500 }))

  assert.deepEqual(watcher.failures.responseFailures, ["500 /api/profiles/me"])
  assert.deepEqual(watcher.observedExpectedInjectedFailures(), [])
})

test("Given an unregistered profile API request failure, watcher records the request failure", () => {
  const page = new FakePage()
  const watcher = watchUnexpectedRuntimeFailures(page)

  page.emit(
    "requestfailed",
    fakeRequest({
      errorText: "net::ERR_FAILED",
      method: "PATCH",
      resourceType: "fetch",
      url: "http://127.0.0.1:3000/api/profiles/me",
    }),
  )

  assert.deepEqual(watcher.failures.requestFailures, ["PATCH /api/profiles/me"])
})

test("Given exact injected profile API failures, watcher allows only the registered requests", () => {
  const page = new FakePage()
  const watcher = watchUnexpectedRuntimeFailures(page)
  const serverRequest = fakeRequest({
    method: "PATCH",
    resourceType: "fetch",
    url: "http://127.0.0.1:3000/api/profiles/me",
  })
  const abortRequest = fakeRequest({
    errorText: "net::ERR_FAILED",
    method: "PATCH",
    resourceType: "fetch",
    url: "http://127.0.0.1:3000/api/profiles/me",
  })

  watcher.expectInjectedProfileFailure(serverRequest, "server-500", 1)
  watcher.expectInjectedProfileFailure(abortRequest, "network-abort", 2)
  page.emit("response", fakeResponse({ request: serverRequest, status: 500 }))
  page.emit("console", fakeConsole(server500ConsoleMessage))
  page.emit("requestfailed", abortRequest)
  page.emit("console", fakeConsole(networkAbortConsoleMessage))

  assert.deepEqual(watcher.failures, emptyFailures())
  assert.deepEqual(watcher.observedExpectedInjectedFailures(), [
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
  ])
})

test("Given ordinal two arrives before ordinal one, watcher records it without mutating the queue", () => {
  const page = new FakePage()
  const watcher = watchUnexpectedRuntimeFailures(page)
  const first = fakeRequest({ method: "PATCH", resourceType: "fetch", url: profileApiUrl() })
  const second = fakeRequest({
    errorText: "net::ERR_FAILED",
    method: "PATCH",
    resourceType: "fetch",
    url: profileApiUrl(),
  })

  watcher.expectInjectedProfileFailure(first, "server-500", 1)
  watcher.expectInjectedProfileFailure(second, "network-abort", 2)
  page.emit("requestfailed", second)
  page.emit("response", fakeResponse({ request: first, status: 500 }))

  assert.deepEqual(watcher.failures.requestFailures, ["PATCH /api/profiles/me"])
  assert.deepEqual(
    watcher.observedExpectedInjectedFailures().map((receipt) => receipt.observed),
    [true, false],
  )
})

test("Given a duplicate injected ordinal, watcher rejects the ambiguous registration", () => {
  const page = new FakePage()
  const watcher = watchUnexpectedRuntimeFailures(page)

  watcher.expectInjectedProfileFailure(
    fakeRequest({ method: "PATCH", resourceType: "fetch", url: profileApiUrl() }),
    "server-500",
    1,
  )
  assert.throws(
    () =>
      watcher.expectInjectedProfileFailure(
        fakeRequest({ method: "PATCH", resourceType: "fetch", url: profileApiUrl() }),
        "network-abort",
        1,
      ),
    /Duplicate injected profile failure ordinal/u,
  )
})

test("Given an extra third profile API failure, watcher records it as unexpected", () => {
  const page = new FakePage()
  const watcher = watchUnexpectedRuntimeFailures(page)
  const first = fakeRequest({ method: "PATCH", resourceType: "fetch", url: profileApiUrl() })
  const second = fakeRequest({
    errorText: "net::ERR_FAILED",
    method: "PATCH",
    resourceType: "fetch",
    url: profileApiUrl(),
  })

  watcher.expectInjectedProfileFailure(first, "server-500", 1)
  watcher.expectInjectedProfileFailure(second, "network-abort", 2)
  page.emit("response", fakeResponse({ request: first, status: 500 }))
  page.emit("requestfailed", second)
  page.emit(
    "requestfailed",
    fakeRequest({
      errorText: "net::ERR_FAILED",
      method: "PATCH",
      resourceType: "fetch",
      url: profileApiUrl(),
    }),
  )

  assert.deepEqual(watcher.failures.requestFailures, ["PATCH /api/profiles/me"])
})

test("Given an injected console side-effect before the matching failure, watcher records it", () => {
  const page = new FakePage()
  const watcher = watchUnexpectedRuntimeFailures(page)
  const request = fakeRequest({
    method: "PATCH",
    resourceType: "fetch",
    url: "http://127.0.0.1:3000/api/profiles/me",
  })

  watcher.expectInjectedProfileFailure(request, "server-500", 1)
  page.emit("console", fakeConsole(server500ConsoleMessage))

  assert.deepEqual(watcher.failures.consoleErrors, [server500ConsoleMessage])
})

test("Given delayed injected console side-effects arrive out of order, watcher records the later one", () => {
  const page = new FakePage()
  const watcher = watchUnexpectedRuntimeFailures(page)
  const first = fakeRequest({ method: "PATCH", resourceType: "fetch", url: profileApiUrl() })
  const second = fakeRequest({
    errorText: "net::ERR_FAILED",
    method: "PATCH",
    resourceType: "fetch",
    url: profileApiUrl(),
  })

  watcher.expectInjectedProfileFailure(first, "server-500", 1)
  watcher.expectInjectedProfileFailure(second, "network-abort", 2)
  page.emit("response", fakeResponse({ request: first, status: 500 }))
  page.emit("requestfailed", second)
  page.emit("console", fakeConsole(networkAbortConsoleMessage))
  page.emit("console", fakeConsole(server500ConsoleMessage))

  assert.deepEqual(watcher.failures.consoleErrors, [networkAbortConsoleMessage])
  assert.deepEqual(
    watcher.observedExpectedInjectedFailures().map((receipt) => receipt.consoleObserved),
    [true, false],
  )
})

test("Given an injected console side-effect twice, watcher consumes only the first one", () => {
  const page = new FakePage()
  const watcher = watchUnexpectedRuntimeFailures(page)
  const request = fakeRequest({ method: "PATCH", resourceType: "fetch", url: profileApiUrl() })

  watcher.expectInjectedProfileFailure(request, "server-500", 1)
  page.emit("response", fakeResponse({ request, status: 500 }))
  page.emit("console", fakeConsole(server500ConsoleMessage))
  page.emit("console", fakeConsole(server500ConsoleMessage))

  assert.deepEqual(watcher.failures.consoleErrors, [server500ConsoleMessage])
})

test("Given a same-page document failure without Chromium abort text, watcher records it", () => {
  const page = new FakePage()
  const watcher = watchUnexpectedRuntimeFailures(page)
  const scope = watcher.beginExpectedSamePageNavigationAbort()

  page.emit(
    "requestfailed",
    fakeRequest({
      errorText: "net::ERR_CONNECTION_RESET",
      method: "GET",
      resourceType: "document",
      url: "http://127.0.0.1:3000/mypage/profile",
    }),
  )
  scope.end()

  assert.deepEqual(watcher.failures.requestFailures, ["GET /mypage/profile"])
})

test("Given an exact same-page Chromium document abort in scope, watcher allows it", () => {
  const page = new FakePage()
  const watcher = watchUnexpectedRuntimeFailures(page)
  const scope = watcher.beginExpectedSamePageNavigationAbort()

  page.emit(
    "requestfailed",
    fakeRequest({
      errorText: "net::ERR_ABORTED",
      method: "GET",
      resourceType: "document",
      url: "http://127.0.0.1:3000/mypage/profile",
    }),
  )
  page.emit("console", fakeConsole("Failed to load resource: net::ERR_ABORTED"))
  scope.end()
  page.emit("console", fakeConsole("Failed to load resource: net::ERR_ABORTED"))

  assert.equal(watcher.observedNavigationAborts(), 1)
  assert.deepEqual(watcher.failures.consoleErrors, ["Failed to load resource: net::ERR_ABORTED"])
  assert.deepEqual(watcher.failures.requestFailures, [])
})
