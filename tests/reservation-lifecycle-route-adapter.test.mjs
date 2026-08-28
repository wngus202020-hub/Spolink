import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import typescript from "typescript"

registerHooks({
  load(url, context, nextLoad) {
    if (!new URL(url).pathname.endsWith(".ts")) return nextLoad(url, context)
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
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const candidate = new URL(`../${specifier.slice(2)}.ts`, import.meta.url)
      return { shortCircuit: true, url: candidate.href }
    }
    if (!specifier.startsWith(".") || !context.parentURL?.startsWith("file:")) {
      return nextResolve(specifier, context)
    }
    const candidate = new URL(`${specifier}.ts`, context.parentURL)
    return existsSync(fileURLToPath(candidate))
      ? { shortCircuit: true, url: candidate.href }
      : nextResolve(specifier, context)
  },
})

const { createReservationLifecycleRouteAdapter } = await import(
  `${pathToFileURL("lib/reservations/reservation-lifecycle-route-adapter.ts").href}?8r`
)

function createAdapter() {
  return createReservationLifecycleRouteAdapter({
    createSession: async () => {
      throw new Error("session creation must not run in boundary characterization")
    },
    getConfigStatus: () => ({ configured: false }),
    parseRequest: () => ({
      request: {
        action: "complete",
        reason: null,
        reservationId: "00000000-0000-4000-8000-000000000001",
      },
      status: "success",
    }),
    respond: (body, init) => Response.json(body, init),
    runWorkflow: async () => {
      throw new Error("workflow must not run in boundary characterization")
    },
  })
}

async function post(headers, url = "http://127.0.0.1:43123/api/reservations/id/complete") {
  return createAdapter()(
    new Request(url, {
      body: "{}",
      headers,
      method: "POST",
    }),
    "00000000-0000-4000-8000-000000000001",
  )
}

test("lifecycle adapter accepts an exact same-origin mutation before config access", async () => {
  const response = await post({
    "content-type": "application/json",
    origin: "http://127.0.0.1:43123",
  })

  assert.equal(response.status, 503)
})

test("lifecycle adapter accepts the legitimate managed Next browser origin", async () => {
  const response = await post(
    {
      "content-type": "application/json",
      host: "127.0.0.1:43123",
      origin: "http://127.0.0.1:43123",
      referer: "http://127.0.0.1:43123/coach/reservations",
      "sec-fetch-site": "same-origin",
    },
    "http://localhost:43123/api/reservations/id/complete",
  )

  assert.equal(response.status, 503)
})

for (const [name, origin] of [
  ["missing", null],
  ["hostile", "https://attacker.example"],
  ["malformed", "://invalid-origin"],
]) {
  test(`lifecycle adapter rejects ${name} origin before content parsing`, async () => {
    const headers = new Headers({ "content-type": "application/json" })
    if (origin) headers.set("origin", origin)
    const response = await post(headers)

    assert.equal(response.status, 403)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.deepEqual(await response.json(), {
      error: {
        code: "FORBIDDEN",
        details: [],
        message: "Same-origin request required.",
      },
    })
  })
}

test("lifecycle adapter ignores an untrusted malformed Host", async () => {
  const response = await post(
    {
      "content-type": "application/json",
      host: "bad host",
      origin: "http://127.0.0.1:43123",
      "sec-fetch-site": "same-origin",
    },
    "http://localhost:43123/api/reservations/id/complete",
  )

  assert.equal(response.status, 503)
})

test("lifecycle adapter rejects attacker-controlled matching Host and Origin", async () => {
  const response = await post({
    "content-type": "application/json",
    host: "attacker.example:43123",
    origin: "http://attacker.example:43123",
  })

  assert.equal(response.status, 403)
})
