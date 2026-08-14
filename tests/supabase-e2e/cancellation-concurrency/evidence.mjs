import { createHash } from "node:crypto"
import { writeFile } from "node:fs/promises"

import { readTodo7ConnectionCount } from "../database-barrier.mjs"
import { capturePort3002 } from "../next-server.mjs"

export async function finalizeTodo7Evidence({
  barrier,
  before3002,
  observations,
  observer,
  provision,
  server,
}) {
  const cleanup = []
  const errors = []
  await attemptCleanup(cleanup, errors, "owned-next", async () => {
    if (!server) return { ownedPid: null, skipped: true }
    const result = await server.stop()
    return {
      exitCode: result.exitCode,
      ownedPid: server.ownedPid,
      port: server.port,
      signal: result.signal,
    }
  })
  await attemptCleanup(cleanup, errors, "barrier-client", async () => {
    if (!barrier) return { skipped: true }
    await barrier.close()
    return { closed: true }
  })
  await attemptCleanup(cleanup, errors, "observer-client", async () => {
    if (!observer) return { skipped: true }
    await observer.end({ timeout: 1 })
    return { closed: true }
  })
  await attemptCleanup(cleanup, errors, "provisioned-auth", async () => {
    if (!provision) return { skipped: true }
    await provision.cleanup()
    return { cleaned: true }
  })

  const status = provision?.status ?? null
  const cleanupObservation = {
    after3002: await capturePort3002(),
    before3002,
    cleanup,
    sqlConnectionsAfterCleanup: status ? await readTodo7ConnectionCount(status.dbUrl) : null,
  }
  observations.push({
    name: "cleanup",
    sha256: sha256(cleanupObservation),
    value: cleanupObservation,
  })
  const artifact = `.omo/evidence/task-7-resume-1-observer-${process.pid}-${Date.now()}.json`
  const contents = `${JSON.stringify({ observations }, null, 2)}\n`
  await writeFile(artifact, contents, { flag: "wx", mode: 0o600 })
  const artifactSha256 = sha256(contents)
  console.log(`TODO7_OBSERVER ${JSON.stringify({ artifact, artifactSha256, observations })}`)

  if (errors.length > 0) throw new AggregateError(errors, "Todo7 cleanup failed")
  return { artifact, artifactSha256 }
}

async function attemptCleanup(receipts, errors, name, cleanup) {
  try {
    receipts.push({ name, result: await cleanup() })
  } catch (error) {
    errors.push(error)
    receipts.push({
      error: error instanceof Error ? error.message : String(error),
      name,
      result: "failed",
    })
  }
}

function sha256(value) {
  const input = typeof value === "string" ? value : JSON.stringify(value)
  return createHash("sha256").update(input).digest("hex")
}
