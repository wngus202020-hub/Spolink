const mailpitOrigin = "http://127.0.0.1:54324"

export async function waitForVerificationMessage({ apiUrl, recipient, redirectTo, type }) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const messages = await listMessages()
    const matches = messages.filter(
      (message) =>
        typeof message.ID === "string" &&
        Array.isArray(message.To) &&
        message.To.some((target) => target?.Address === recipient),
    )
    if (matches.length > 1) throw new Error("Mailpit returned duplicate messages for recipient.")
    if (matches.length === 1) {
      const message = matches[0]
      if (!message || typeof message.ID !== "string") throw new Error("Invalid Mailpit message.")
      return {
        href: await readVerificationHref(message.ID, { apiUrl, redirectTo, type }),
        id: message.ID,
      }
    }
    await delay(100)
  }
  throw new Error("Mailpit verification message timed out.")
}

export async function deleteVerificationMessage(id) {
  const response = await fetch(`${mailpitOrigin}/api/v1/messages`, {
    body: JSON.stringify({ IDs: [id] }),
    headers: { "Content-Type": "application/json" },
    method: "DELETE",
  })
  if (!response.ok || (await response.text()).trim() !== "ok") {
    throw new Error("Mailpit message deletion failed.")
  }
  console.log(JSON.stringify({ event: "mailpit-cleanup", messageDeleted: true }))
}

async function listMessages() {
  const response = await fetch(`${mailpitOrigin}/api/v1/messages?start=0&limit=50`)
  if (!response.ok) throw new Error("Mailpit message list failed.")
  const body = await response.json()
  if (!body || !Array.isArray(body.messages)) throw new Error("Invalid Mailpit message list.")
  return body.messages
}

async function readVerificationHref(id, expected) {
  const response = await fetch(`${mailpitOrigin}/view/${encodeURIComponent(id)}.html`)
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
    throw new Error("Invalid Mailpit message response.")
  }
  const html = await response.text()
  if (Buffer.byteLength(html) > 1024 * 1024) throw new Error("Mailpit message exceeds limit.")
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/giu)].map((match) =>
    match[1].replaceAll("&amp;", "&"),
  )
  const matches = hrefs.filter((href) => isExpectedVerificationHref(href, expected))
  if (matches.length !== 1) throw new Error("Expected exactly one guarded verification link.")
  const href = matches[0]
  if (typeof href !== "string") throw new Error("Verification link is unavailable.")
  if (process.env["SPOLINK_AUTH_E2E_INJECT_FAILURE"] === "after-mailpit-link") {
    await deleteVerificationMessage(id)
    throw new Error("Injected auth E2E failure: after-mailpit-link")
  }
  return href
}

function isExpectedVerificationHref(href, expected) {
  try {
    const url = new URL(href)
    return (
      url.origin === new URL(expected.apiUrl).origin &&
      url.pathname === "/auth/v1/verify" &&
      Boolean(url.searchParams.get("token")) &&
      url.searchParams.get("type") === expected.type &&
      url.searchParams.get("redirect_to") === expected.redirectTo
    )
  } catch {
    return false
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
