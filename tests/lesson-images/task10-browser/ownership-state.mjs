import assert from "node:assert/strict"
import net from "node:net"

import { readGuardedLocalStatus } from "../../supabase-e2e/local-status.mjs"
import { runCapture } from "./process-runner.mjs"

export async function readOwnershipState() {
  const status = await readGuardedLocalStatus()
  const [port3000Status, supabaseApiStatus, port3000Pid, port3268Free] = await Promise.all([
    fetch("http://127.0.0.1:3000/").then((response) => response.status),
    fetch(`${status.apiUrl}/auth/v1/health`).then((response) => response.status),
    readPortPid(3000),
    isPortFree(3268),
  ])
  return { port3000Pid, port3000Status, port3268Free, supabaseApiStatus }
}

export function assertPreservedOwnership(initial, final) {
  assert.equal(final.port3000Pid, initial.port3000Pid, "pre-existing port 3000 process changed")
  assert.equal(final.port3000Status, 200)
  assert.equal(final.supabaseApiStatus, 200)
  assert.equal(final.port3268Free, true)
}

async function readPortPid(port) {
  const result = await runCapture("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])
  const pid = Number(result.trim().split(/\s+/u)[0])
  assert.equal(Number.isInteger(pid) && pid > 0, true, `port ${port} listener missing`)
  return pid
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => server.close(() => resolve(true)))
    server.listen(port, "127.0.0.1")
  })
}
