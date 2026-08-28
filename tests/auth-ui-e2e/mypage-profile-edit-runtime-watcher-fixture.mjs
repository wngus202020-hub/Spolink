export class FakePage {
  #listeners = new Map()

  on(event, listener) {
    const listeners = this.#listeners.get(event) ?? []
    listeners.push(listener)
    this.#listeners.set(event, listeners)
  }

  emit(event, value) {
    for (const listener of this.#listeners.get(event) ?? []) listener(value)
  }
}

export const networkAbortConsoleMessage = "Failed to load resource: net::ERR_FAILED"

export const server500ConsoleMessage =
  "Failed to load resource: the server responded with a status of 500 (Internal Server Error)"

export function emptyFailures() {
  return {
    apiMeRequests: 0,
    consoleErrors: [],
    requestFailures: [],
    responseFailures: [],
  }
}

export function fakeConsole(text) {
  return {
    text: () => text,
    type: () => "error",
  }
}

export function fakeRequest({ errorText = null, method, resourceType, url }) {
  return {
    failure: () => (errorText === null ? null : { errorText }),
    method: () => method,
    resourceType: () => resourceType,
    url: () => url,
  }
}

export function fakeResponse({ request, status }) {
  return {
    request: () => request,
    status: () => status,
    url: () => request.url(),
  }
}

export function profileApiUrl() {
  return "http://127.0.0.1:3000/api/profiles/me"
}
