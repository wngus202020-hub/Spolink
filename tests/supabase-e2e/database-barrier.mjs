import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import postgres from "postgres"

const pollMs = 25
const maxWaitMs = 5_000

export function createDatabaseBarrier(dbUrl, applicationName) {
  const sql = postgres(withApplicationName(dbUrl, applicationName), { idle_timeout: 1, max: 2 })
  return {
    async captureBaseline() {
      const rows = await sql`
        select pid
        from pg_stat_activity
        where datname = current_database()
          and wait_event_type = 'Lock'
      `
      return new Set(rows.map((row) => row.pid))
    },
    close: () => sql.end({ timeout: 1 }),
    holdReservation: (reservationId) => holdReservation(sql, reservationId),
    waitForBlocked: (options) => waitForBlocked(sql, options),
  }
}

export async function readTodo7ConnectionCount(dbUrl) {
  const sql = postgres(withApplicationName(dbUrl, "spolink-todo7-leak-check"), {
    idle_timeout: 1,
    max: 1,
  })
  try {
    const [row] = await sql`
      select count(*)::int as count
      from pg_stat_activity
      where application_name like 'spolink-todo7-%'
        and application_name <> 'spolink-todo7-leak-check'
    `
    return row.count
  } finally {
    await sql.end({ timeout: 1 })
  }
}

async function holdReservation(sql, reservationId) {
  let release
  let abort
  let lockerPid
  const locked = deferred()
  const released = new Promise((resolve, reject) => {
    release = resolve
    abort = reject
  })
  const done = sql
    .begin(async (tx) => {
      const [pidRow] = await tx`select pg_backend_pid()::int as pid`
      lockerPid = pidRow.pid
      await tx`select id from public.reservations where id = ${reservationId} for update`
      locked.resolve()
      await released
    })
    .catch((error) => {
      if (error.message !== "todo7 barrier rollback") throw error
    })
  await locked.promise
  return {
    abort: () => abort(new Error("todo7 barrier rollback")),
    done,
    lockerPid,
    release,
  }
}

async function waitForBlocked(sql, { baselinePids, lockerPid, workers }) {
  const deadline = Date.now() + maxWaitMs
  let lastRows = []
  while (Date.now() < deadline) {
    const rows = await sql`
      select pid::int, wait_event_type, wait_event, query,
        extract(epoch from query_start) * 1000 as query_start_ms,
        extract(epoch from state_change) * 1000 as state_change_ms,
        pg_blocking_pids(pid)::int[] as blockers
      from pg_stat_activity
      where datname = current_database()
        and wait_event_type = 'Lock'
        and pid <> ${lockerPid}
    `
    lastRows = rows
    const candidates = rows.filter((row) => !baselinePids.has(row.pid)).map(normalizeCandidate)
    const candidateMap = new Map(candidates.map((row) => [row.pid, row]))
    const owned = candidates
      .map((row) => ({ chain: findOwnedBlockerChain(row, candidateMap, lockerPid), row }))
      .filter((candidate) => candidate.chain !== null)
    const matches = workers.map((worker) => {
      const found = owned.filter(({ row }) => matchesWorkerIdentity(row, worker))
      if (found.length > 1) {
        throw new Error(`Observed ${found.length} candidates for worker ${worker.label}`)
      }
      return found[0] ? summarizeWait(found[0], worker, lockerPid) : null
    })
    const complete = matches.every(Boolean)
    const distinct = new Set(matches.filter(Boolean).map((row) => row.pid)).size === workers.length
    if (complete && distinct) return matches
    await delay(pollMs)
  }
  throw new Error(
    `Timed out waiting for owned blocked workers: ${JSON.stringify(
      lastRows.map((row) => ({
        blockers: row.blockers,
        hasFunction: Object.fromEntries(
          workers
            .flatMap((worker) => worker.functionNames)
            .map((name) => [name, row.query.includes(name)]),
        ),
        pid: row.pid,
        queryStartMs: Number(row.query_start_ms),
        querySha256: sha256(row.query),
        stateChangeMs: Number(row.state_change_ms),
        waitEvent: row.wait_event,
        waitEventType: row.wait_event_type,
      })),
    )}`,
  )
}

export function findOwnedBlockerChain(row, candidateMap, lockerPid, seen = new Set()) {
  if (row.blockers.length !== 1) return null
  if (row.blockers[0] === lockerPid) return [row.pid, lockerPid]
  if (seen.has(row.pid)) return null
  const nextSeen = new Set(seen).add(row.pid)
  const blocker = candidateMap.get(row.blockers[0])
  if (!blocker) return null
  const chain = findOwnedBlockerChain(blocker, candidateMap, lockerPid, nextSeen)
  return chain ? [row.pid, ...chain] : null
}

export function matchesWorkerIdentity(row, worker) {
  return (
    (worker.pid === undefined || row.pid === worker.pid) &&
    worker.functionNames.some((name) => row.query.includes(name)) &&
    row.queryStartMs >= worker.startedAtWallMs &&
    row.stateChangeMs >= worker.startedAtWallMs
  )
}

function normalizeCandidate(row) {
  return {
    ...row,
    queryStartMs: Number(row.query_start_ms),
    stateChangeMs: Number(row.state_change_ms),
  }
}

function summarizeWait({ chain, row }, worker, lockerPid) {
  const matchedFunction = worker.functionNames.find((name) => row.query.includes(name))
  return {
    baselineExcluded: true,
    blockerChain: chain,
    lockerPid,
    matchedFunction,
    pid: row.pid,
    queryStartMs: row.queryStartMs,
    querySha256: sha256(row.query),
    stateChangeMs: row.stateChangeMs,
    waitEvent: row.wait_event,
    waitEventType: row.wait_event_type,
    workerLabel: worker.label,
    workerStartedAtHrtimeNs: worker.startedAtHrtimeNs,
    workerStartedAtWallMs: worker.startedAtWallMs,
  }
}

function withApplicationName(dbUrl, applicationName) {
  const url = new URL(dbUrl)
  url.searchParams.set("application_name", applicationName)
  return url.toString()
}

function deferred() {
  const result = {}
  result.promise = new Promise((resolve, reject) => {
    result.resolve = resolve
    result.reject = reject
  })
  return result
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function sha256(value) {
  assert.equal(typeof value, "string")
  return createHash("sha256").update(value).digest("hex")
}
