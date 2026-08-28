export function attachBrowserTelemetry(page, runtime) {
  page.on("console", (message) => {
    if (message.type() !== "error") return
    if (/Failed to load resource:.*(?:400|404)/u.test(message.text())) {
      runtime.expectedNetworkConsoleErrors.push(message.text())
    } else {
      runtime.consoleErrors.push(message.text())
    }
  })
  page.on("pageerror", (error) => runtime.pageErrors.push(error.message))
  page.on("requestfailed", (request) => {
    const receipt = {
      failure: request.failure()?.errorText ?? "unknown",
      method: request.method(),
      path: redactPath(new URL(request.url()).pathname),
    }
    if (receipt.failure === "net::ERR_ABORTED") runtime.abortedRequests.push(receipt)
    else if (
      receipt.failure === "net::ERR_BLOCKED_BY_ORB" &&
      receipt.path.includes("/storage/v1/object/public/lesson-images/")
    ) {
      runtime.expectedFailedRequests.push(receipt)
    } else runtime.failedRequests.push(receipt)
  })
  page.on("response", (response) => {
    const url = new URL(response.url())
    if (url.pathname.includes("/lessons") || url.pathname.includes("/storage/v1/")) {
      runtime.responses.push({
        method: response.request().method(),
        path: redactPath(url.pathname),
        status: response.status(),
      })
    }
  })
}

export function createRuntimeReceipt() {
  return {
    abortedRequests: [],
    consoleErrors: [],
    expectedFailedRequests: [],
    expectedNetworkConsoleErrors: [],
    failedRequests: [],
    pageErrors: [],
    responses: [],
  }
}

function redactPath(pathname) {
  return pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/giu, "<id>")
}
