import { createHash } from "node:crypto"
import http from "node:http"

import { closeServer, listen, readRequestBody } from "./network.mjs"

export async function startLessonImageFaultProxy(upstreamBaseUrl) {
  const faults = new Map()
  const observations = []
  let normalizeIntentTimestamp = false
  const upstream = new URL(upstreamBaseUrl)
  const server = http.createServer(async (request, response) => {
    const body = await readRequestBody(request)
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname
    const fault = matchingFault(request.method ?? "GET", pathname, faults)
    if (fault) {
      observations.push({
        kind: fault,
        requestSha256: sha256(`${request.method}:${pathname}`),
        status: 503,
      })
      response.writeHead(503, { "content-type": "application/json" })
      response.end(JSON.stringify({ code: "TEST_PROVIDER_FAILURE", message: "Injected failure" }))
      return
    }

    try {
      const headers = new Headers()
      for (const [name, value] of Object.entries(request.headers)) {
        if (value === undefined || name.toLowerCase() === "host") continue
        if (Array.isArray(value)) {
          for (const item of value) headers.append(name, item)
        } else {
          headers.set(name, value)
        }
      }
      const target = new URL(request.url ?? "/", upstream)
      const upstreamResponse = await fetch(target, {
        body: body.length > 0 ? body : undefined,
        headers,
        method: request.method,
        redirect: "manual",
      })
      const responseHeaders = {}
      upstreamResponse.headers.forEach((value, name) => {
        if (!["content-encoding", "content-length", "transfer-encoding"].includes(name)) {
          responseHeaders[name] = value
        }
      })
      let responseBody = Buffer.from(await upstreamResponse.arrayBuffer())
      if (
        normalizeIntentTimestamp &&
        upstreamResponse.ok &&
        (pathname.endsWith("/rest/v1/rpc/create_lesson_image_upload_intent") ||
          pathname.endsWith("/rest/v1/lesson_image_upload_intents"))
      ) {
        const rows = JSON.parse(responseBody.toString("utf8"))
        responseBody = Buffer.from(
          JSON.stringify(
            rows.map((row) => ({ ...row, expires_at: new Date(row.expires_at).toISOString() })),
          ),
        )
        observations.push({
          kind: "test_timestamp_normalization",
          requestSha256: sha256(`${request.method}:${pathname}`),
          status: upstreamResponse.status,
        })
      }
      response.writeHead(upstreamResponse.status, responseHeaders)
      response.end(responseBody)
    } catch {
      response.writeHead(502, { "content-type": "application/json" })
      response.end(JSON.stringify({ code: "TEST_PROXY_FAILURE", message: "Proxy failure" }))
    }
  })

  await listen(server)
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Fault proxy has no TCP address")

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    failNext(kind) {
      faults.set(kind, (faults.get(kind) ?? 0) + 1)
    },
    normalizeIntentTimestamps() {
      normalizeIntentTimestamp = true
    },
    observations,
    pendingFaults() {
      return [...faults.values()].reduce((total, count) => total + count, 0)
    },
    async stop() {
      await closeServer(server)
    },
  }
}

function matchingFault(method, pathname, faults) {
  const candidates = [
    [
      "storage_delete",
      method === "DELETE" && pathname.includes("/storage/v1/object/lesson-images"),
    ],
    [
      "register_rpc",
      method === "POST" && pathname.endsWith("/rest/v1/rpc/register_validated_lesson_image"),
    ],
    [
      "finalize_delete_rpc",
      method === "POST" && pathname.endsWith("/rest/v1/rpc/finalize_delete_lesson_image"),
    ],
  ]
  for (const [kind, matches] of candidates) {
    const count = faults.get(kind) ?? 0
    if (matches && count > 0) {
      faults.set(kind, count - 1)
      return kind
    }
  }
  return null
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
