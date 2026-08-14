#!/usr/bin/env node
import { writeFile } from "node:fs/promises"
import process from "node:process"
import { createClient } from "@supabase/supabase-js"
import postgres from "postgres"

export { assertFixtureGraph, readExactFixtureGraph } from "./fixtures/assertions.mjs"
export {
  assertSignIns,
  createFixtureAuthUsers,
  listFixtureAuthUsers,
} from "./provision/auth-lifecycle.mjs"
export { cleanupFixtureGraph, readFixtureCounts } from "./provision/teardown.mjs"

import { assertFixtureGraph } from "./fixtures/assertions.mjs"
import { buildFixtureRows, fixtureUsers } from "./fixtures.mjs"
import { readGuardedLocalStatus } from "./local-status.mjs"
import {
  assertSignIns,
  createFixtureAuthUsers,
  generateRunPassword,
  listFixtureAuthUsers,
  sha256,
} from "./provision/auth-lifecycle.mjs"
import {
  createCredentialManifestPath,
  removeCredentialManifest,
} from "./provision/credential-manifest.mjs"
import { insertFixtureGraph, readTennisSportId } from "./provision/graph.mjs"
import {
  assertNoFixtureResidue,
  cleanupFixtureGraph,
  readFixtureCounts,
} from "./provision/teardown.mjs"

export async function provisionFixtures(options = {}) {
  const status = options.status ?? (await readGuardedLocalStatus(options))
  const serviceClient = createClient(status.apiUrl, status.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const anonClient = createClient(status.apiUrl, status.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const sql = postgres(status.dbUrl, { max: 1, idle_timeout: 1 })
  const credentialManifest = await createCredentialManifestPath(options.manifestPath)
  const manifestPath = credentialManifest.path
  const runPassword = generateRunPassword()
  try {
    const authUsersBefore = await listFixtureAuthUsers(serviceClient)
    const firstGenerationIds = authUsersBefore.map((user) => user.id)
    await cleanupFixtureGraph(sql, serviceClient, authUsersBefore)
    await assertNoFixtureResidue(sql)
    const authIds = await createFixtureAuthUsers(serviceClient, runPassword)
    const tennisSportId = await readTennisSportId(sql)
    const epoch = options.epoch ?? new Date()
    const rows = buildFixtureRows({ epoch, authIds, tennisSportId })
    await insertFixtureGraph(sql, rows)
    await assertFixtureGraph(sql, rows, authIds)
    await assertSignIns(anonClient, runPassword)
    await writeFile(
      manifestPath,
      JSON.stringify({
        createdAt: new Date().toISOString(),
        fixtureKeys: fixtureUsers.map((user) => user.key),
      }),
      { mode: 0o600 },
    )
    if (!options.retainCredentialManifest) {
      await removeCredentialManifest(credentialManifest)
    }
    return {
      status,
      authIds,
      firstGenerationIds,
      runPassword,
      passwordSha256: sha256(runPassword),
      manifestPath,
      epoch: rows.epoch,
      rows,
      counts: await readFixtureCounts(sql),
      clients: { serviceClient, anonClient },
      cleanup: async () => {
        await sql.end({ timeout: 1 })
        await removeCredentialManifest(credentialManifest)
      },
    }
  } catch (error) {
    await removeCredentialManifest(credentialManifest)
    await sql.end({ timeout: 1 })
    throw error
  }
}

async function main() {
  const pgTap = process.argv.includes("--pg-tap")
  const result = await provisionFixtures({ retainCredentialManifest: false })
  await result.cleanup()
  console.log(
    JSON.stringify({
      pgTap,
      epoch: result.epoch,
      passwordSha256: result.passwordSha256,
      counts: result.counts,
      users: Object.keys(result.authIds).sort(),
    }),
  )
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
