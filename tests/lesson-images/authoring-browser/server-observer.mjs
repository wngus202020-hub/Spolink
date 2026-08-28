export function observeAuthoringServer(page, runtime) {
  const requestSequence = []
  let providerUploadCount = 0

  page.on("console", (message) => {
    if (message.type() !== "error") return
    const locationPath = new URL(message.location().url || "http://127.0.0.1/").pathname
    const expectedAuthoringFailure = /Failed to load resource:.*(?:404|409|422|503)/u.test(
      message.text(),
    )
    const expectedTransitionImageFailure =
      locationPath === "/_next/image" &&
      /Failed to load resource:.*(?:400|404)/u.test(message.text())
    if (expectedAuthoringFailure || expectedTransitionImageFailure) {
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
      path: new URL(request.url()).pathname,
    }
    if (receipt.failure === "net::ERR_ABORTED") runtime.abortedRequests.push(receipt)
    else runtime.failedRequests.push(receipt)
  })
  page.on("response", (response) => {
    const url = new URL(response.url())
    if (url.pathname.includes("/api/lessons") || url.pathname.includes("/storage/v1/")) {
      runtime.responses.push({
        method: response.request().method(),
        path: url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/giu, "<id>"),
        status: response.status(),
      })
    }
  })
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (url.pathname === "/api/lessons" && request.method() === "POST") {
      requestSequence.push("create")
    } else if (url.pathname.endsWith("/images/upload-intents")) {
      requestSequence.push("intent")
    } else if (url.pathname.endsWith("/images") && request.method() === "POST") {
      requestSequence.push("register")
    } else if (url.pathname.includes("/storage/v1/object/upload/sign/lesson-images/")) {
      requestSequence.push("upload")
    }
  })
  page.route("**/storage/v1/object/upload/sign/lesson-images/**", async (route) => {
    providerUploadCount += 1
    if (providerUploadCount === 2) {
      await route.fulfill({ body: "{}", contentType: "application/json", status: 200 })
      return
    }
    await route.continue()
  })
  return requestSequence
}
