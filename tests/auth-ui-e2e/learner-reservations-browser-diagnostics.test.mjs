import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"

import {
  assertBrowserDiagnosticsClean,
  attachLearnerReservationBrowserDiagnostics,
  UnexpectedBrowserDiagnosticsError,
} from "./learner-reservations-browser-diagnostics.ts"
import { assertBrowserDiagnosticsReceipt } from "./learner-reservations-evidence-validation.mjs"

const appOrigin = "http://127.0.0.1:3006"

test("browser diagnostics records only redacted expected HTTP and warning counts", () => {
  // Given: a fresh page collector is attached before any event is emitted.
  const page = new FakePage()
  const collector = attachLearnerReservationBrowserDiagnostics(page, appOrigin)

  // When: the page emits routine success, the exact state-test 404s, and one download abort.
  page.emit("response", response(`${appOrigin}/healthy`, 200))
  page.emit("console", consoleMessage("warning", "private warning detail"))
  for (let index = 0; index < 3; index += 1) {
    const url = `${appOrigin}/reservations/private-id/complete?token=secret`
    page.emit("response", response(url, 404))
    page.emit("console", consoleMessage("error", "Failed to load resource: 404", url))
  }
  page.emit("response", response(`${appOrigin}/mypage/reservations/private-id`, 404))
  page.emit(
    "console",
    consoleMessage(
      "error",
      "Failed to load resource: 404",
      `${appOrigin}/mypage/reservations/private-id`,
    ),
  )
  page.emit(
    "requestfailed",
    request(`${appOrigin}/api/reservations/private-id/calendar`, {
      errorText: "net::ERR_ABORTED",
      isNavigationRequest: true,
      resourceType: "document",
    }),
  )
  const receipt = collector.finish()

  // Then: only categorical counts remain and the expected failures are not unexpected.
  assert.deepEqual(receipt, {
    expectedHttpFailures: [
      { count: 3, routeCategory: "completion-page", status: 404 },
      { count: 1, routeCategory: "reservation-detail-page", status: 404 },
    ],
    expectedNavigationAbortCount: 1,
    consoleWarningCount: 1,
    unexpected: { consoleError: 0, httpResponse: 0, pageError: 0, requestFailed: 0 },
  })
  assertBrowserDiagnosticsClean(receipt)
})

test("browser diagnostics rejects unexpected events without retaining attack payloads", () => {
  // Given: event payloads contain identities, queries, and secret-like text.
  const page = new FakePage()
  const collector = attachLearnerReservationBrowserDiagnostics(page, appOrigin)

  // When: every unexpected browser event class is emitted.
  page.emit("console", consoleMessage("error", "person@example.test bearer secret-value"))
  page.emit("pageerror", new Error("40000000-0000-4000-8000-000000000799"))
  page.emit("requestfailed", request(`${appOrigin}/private/path?id=private-id&token=secret`))
  page.emit("response", response(`${appOrigin}/private/path?id=private-id`, 503))
  page.emit("response", response(`${appOrigin}/reservations/private-id/complete`, 500))
  page.emit("response", response(`https://outside.test/reservations/private-id/complete`, 404))
  const receipt = collector.finish()

  // Then: the assertion propagates a typed failure and the receipt is payload-free.
  assert.deepEqual(receipt.unexpected, {
    consoleError: 1,
    httpResponse: 3,
    pageError: 1,
    requestFailed: 1,
  })
  assert.throws(() => assertBrowserDiagnosticsClean(receipt), UnexpectedBrowserDiagnosticsError)
  const serialized = JSON.stringify(receipt)
  for (const forbidden of ["person@", "secret", "private-id", "40000000", "outside.test"]) {
    assert.equal(serialized.includes(forbidden), false)
  }
})

test("browser diagnostics detaches listeners and does not leak across pages", () => {
  // Given: independent collectors are attached to two project pages.
  const first = new FakePage()
  const second = new FakePage()
  const firstCollector = attachLearnerReservationBrowserDiagnostics(first, appOrigin)
  const secondCollector = attachLearnerReservationBrowserDiagnostics(second, appOrigin)
  first.emit("console", consoleMessage("warning", "first-only"))

  // When: the first project finishes and later events target its old page.
  const firstReceipt = firstCollector.finish()
  first.emit("console", consoleMessage("error", "must not leak"))
  const secondReceipt = secondCollector.finish()

  // Then: all listeners are removed and the second project stays clean.
  for (const event of ["console", "pageerror", "requestfailed", "response"]) {
    assert.equal(first.listenerCount(event), 0)
    assert.equal(second.listenerCount(event), 0)
  }
  assert.deepEqual(firstReceipt.unexpected, {
    consoleError: 0,
    httpResponse: 0,
    pageError: 0,
    requestFailed: 0,
  })
  assert.deepEqual(secondReceipt.unexpected, firstReceipt.unexpected)
})

test("focused summary validation rejects unexpected and payload-bearing diagnostics", () => {
  // Given: one behavior-produced clean receipt and two malformed variants.
  const page = new FakePage()
  const collector = attachLearnerReservationBrowserDiagnostics(page, appOrigin)
  for (let index = 0; index < 3; index += 1) {
    page.emit("response", response(`${appOrigin}/reservations/private-id/complete`, 404))
  }
  page.emit("response", response(`${appOrigin}/mypage/reservations/private-id`, 404))
  page.emit(
    "requestfailed",
    request(`${appOrigin}/api/reservations/private-id/calendar`, {
      errorText: "net::ERR_ABORTED",
      isNavigationRequest: true,
      resourceType: "document",
    }),
  )
  const clean = collector.finish()

  // When/Then: the real summary validator accepts clean counts and rejects unsafe receipts.
  assert.doesNotThrow(() => assertBrowserDiagnosticsReceipt(clean))
  assert.throws(
    () =>
      assertBrowserDiagnosticsReceipt({
        ...clean,
        unexpected: { ...clean.unexpected, consoleError: 1 },
      }),
    /diagnostics receipt/iu,
  )
  assert.throws(
    () => assertBrowserDiagnosticsReceipt({ ...clean, body: "secret response payload" }),
    /diagnostics receipt/iu,
  )
  assert.throws(
    () =>
      assertBrowserDiagnosticsReceipt({
        ...clean,
        detail: "secret query and fixture identity",
      }),
    /diagnostics receipt/iu,
  )
})

class FakePage extends EventEmitter {
  on(event, listener) {
    super.on(event, listener)
    return this
  }

  off(event, listener) {
    super.off(event, listener)
    return this
  }
}

function consoleMessage(type, text, url = "") {
  return { location: () => ({ url }), text: () => text, type: () => type }
}

function request(url, options = {}) {
  return {
    failure: () => ({ errorText: options.errorText ?? "net::ERR_FAILED" }),
    isNavigationRequest: () => options.isNavigationRequest ?? false,
    method: () => "GET",
    resourceType: () => options.resourceType ?? "fetch",
    url: () => url,
  }
}

function response(url, status) {
  return {
    body: () => {
      throw new Error("diagnostics collector must not read response bodies")
    },
    status: () => status,
    url: () => url,
  }
}
