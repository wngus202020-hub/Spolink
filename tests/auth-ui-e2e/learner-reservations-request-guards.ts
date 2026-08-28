type ReadOnlyRequest = Readonly<{
  method: () => string
  url: () => string
}>

export function isForbiddenReadOnlyRequest(request: ReadOnlyRequest) {
  const url = new URL(request.url())
  if (url.hostname.toLowerCase().includes("toss")) return true
  if (request.method() === "GET") return false
  return (
    /^\/api\/reservations\/[^/]+\/cancel$/u.test(url.pathname) ||
    /^\/api\/reservations\/[^/]+\/complete$/u.test(url.pathname) ||
    /^\/api\/reservations\/[^/]+\/no-show$/u.test(url.pathname) ||
    url.pathname === "/api/payments/confirm" ||
    url.pathname === "/api/payments/prepare"
  )
}
