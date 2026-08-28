import { createHash } from "node:crypto"

import { delay as defaultDelay } from "./network.mjs"

const staticReadinessPath = "/images/lesson-tennis.webp"
const privateApiReadinessPath =
  "/api/lessons/00000000-0000-4000-8000-000000000001/images/upload-intents"
const requestTimeoutMs = 2_000

export async function waitForNextReady(baseUrl, child, output, dependencies = {}) {
  const state = { lastProbe: null, staticReady: false, stopped: false }
  const childTermination = watchChildTermination(child, (event) =>
    readinessError(event, state.lastProbe, child, output, dependencies),
  )

  try {
    const probe = probeUntilReady(baseUrl, child, output, state, dependencies)
    return childTermination ? await Promise.race([probe, childTermination.promise]) : await probe
  } finally {
    state.stopped = true
    childTermination?.cleanup()
  }
}

async function probeUntilReady(baseUrl, child, output, state, dependencies) {
  const delay = dependencies.delay ?? defaultDelay
  const fetchRequest = dependencies.fetch ?? fetch
  const now = dependencies.now ?? Date.now
  const timeoutMs = dependencies.timeoutMs ?? 120_000
  const perRequestTimeoutMs = dependencies.requestTimeoutMs ?? requestTimeoutMs
  const deadline = now() + timeoutMs

  while (!state.stopped && now() < deadline) {
    if (child.exitCode !== null) {
      throw readinessError("exit", state.lastProbe, child, output, dependencies)
    }
    const remainingMs = Math.max(deadline - now(), 1)
    try {
      if (!state.staticReady) {
        const response = await fetchRequest(`${baseUrl}${staticReadinessPath}`, {
          signal: AbortSignal.timeout(Math.min(perRequestTimeoutMs, remainingMs)),
        })
        const bytes = new Uint8Array(await response.arrayBuffer())
        state.lastProbe = responseProbe("static", response, bytes)
        state.staticReady =
          response.status === 200 &&
          state.lastProbe.contentType.startsWith("image/webp") &&
          hasWebpSignature(bytes)
      }
      if (state.staticReady) {
        const response = await fetchRequest(`${baseUrl}${privateApiReadinessPath}`, {
          body: JSON.stringify({ mimeType: "image/png", sizeBytes: 1 }),
          headers: {
            "content-type": "application/json",
            origin: new URL(baseUrl).origin,
          },
          method: "POST",
          signal: AbortSignal.timeout(Math.min(perRequestTimeoutMs, remainingMs)),
        })
        const bytes = new Uint8Array(await response.arrayBuffer())
        state.lastProbe = responseProbe("private-api", response, bytes)
        if (isSemanticPrivateApiReady(state.lastProbe, bytes)) return state.lastProbe
      }
    } catch (error) {
      state.lastProbe = {
        bodySha256: null,
        contentType: null,
        errorMessage: safeTail(error instanceof Error ? error.message : String(error)),
        errorName: error instanceof Error ? error.name : "UnknownError",
        status: null,
      }
    }
    await delay(250)
  }
  if (!state.stopped) {
    throw readinessError("timeout", state.lastProbe, child, output, dependencies)
  }
}

function watchChildTermination(child, createError) {
  if (typeof child.once !== "function" || typeof child.removeListener !== "function") return null

  let rejectPromise
  const promise = new Promise((_resolve, reject) => {
    rejectPromise = reject
  })
  const onError = () => rejectPromise(createError("error"))
  const onExit = () => rejectPromise(createError("exit"))
  const onClose = () => rejectPromise(createError("close"))
  child.once("error", onError)
  child.once("exit", onExit)
  child.once("close", onClose)

  return {
    cleanup() {
      child.removeListener("error", onError)
      child.removeListener("exit", onExit)
      child.removeListener("close", onClose)
    },
    promise,
  }
}

function readinessError(event, lastProbe, child, output, dependencies) {
  const diagnostics = {
    event,
    exitCode: child.exitCode ?? null,
    lastBodySha256: lastProbe?.bodySha256 ?? null,
    lastCacheControl: lastProbe?.cacheControl ?? null,
    lastCode: lastProbe?.code ?? null,
    lastContentType: lastProbe?.contentType ?? null,
    lastErrorMessage: lastProbe?.errorMessage ?? null,
    lastErrorName: lastProbe?.errorName ?? null,
    lastProbeKind: lastProbe?.kind ?? null,
    lastStatus: lastProbe?.status ?? null,
    pidSha256: child.pid ? sha256(String(child.pid)) : null,
    port: dependencies.port ?? null,
    stderrSha256: sha256(output.stderr ?? ""),
    stderrTail: safeTail(output.stderr ?? ""),
    stdoutSha256: sha256(output.stdout ?? ""),
    stdoutTail: safeTail(output.stdout ?? ""),
    tempRootSha256: dependencies.tempRoot ? sha256(dependencies.tempRoot) : null,
  }
  const error = new Error(`Isolated Next readiness failed: ${JSON.stringify(diagnostics)}`)
  error.childDiagnostics = diagnostics
  return error
}

function responseProbe(kind, response, bytes) {
  return {
    bodySha256: sha256(bytes),
    cacheControl: response.headers.get("cache-control") ?? "",
    code: readErrorCode(bytes),
    contentType: response.headers.get("content-type") ?? "",
    errorMessage: null,
    errorName: null,
    kind,
    status: response.status,
  }
}

function isSemanticPrivateApiReady(probe, bytes) {
  return (
    probe.status === 401 &&
    probe.contentType.startsWith("application/json") &&
    probe.cacheControl === "private, no-store" &&
    probe.code === "UNAUTHENTICATED" &&
    bytes.length > 0
  )
}

function readErrorCode(bytes) {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes))
    return typeof parsed?.error?.code === "string" ? parsed.error.code : null
  } catch {
    return null
  }
}

function hasWebpSignature(bytes) {
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
}

function safeTail(value) {
  return value
    .slice(-240)
    .replace(/https?:\/\/\S+/giu, "<url>")
    .replace(/[A-Za-z0-9._-]{12,}/gu, "<redacted>")
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
