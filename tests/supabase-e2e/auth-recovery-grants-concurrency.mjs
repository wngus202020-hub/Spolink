#!/usr/bin/env node
import assert from "node:assert/strict"
import { randomBytes, randomUUID } from "node:crypto"
import process from "node:process"
import postgres from "postgres"

import { readGuardedLocalStatus } from "./local-status.mjs"

const workerCount = 12

async function main() {
  const status = await readGuardedLocalStatus()
  const userId = randomUUID()
  const sessionId = `todo3-${randomBytes(12).toString("base64url")}`
  const tokenHash = randomBytes(32).toString("hex")
  const sql = postgres(withApplicationName(status.dbUrl, "spolink-todo3-grant-main"), {
    idle_timeout: 1,
    max: 2,
  })

  try {
    await createAuthUser(sql, userId)
    const issued = await callGrantRpc(
      sql,
      userId,
      sessionId,
      (tx) => tx`
      select public.issue_password_recovery_grant(
        ${tokenHash},
        statement_timestamp() + interval '5 minutes'
      ) as ok
    `,
    )
    assert.equal(issued, true, "expected authenticated issue RPC to create one grant")

    const results = await Promise.all(
      Array.from({ length: workerCount }, (_unused, index) =>
        consumeWorker(status.dbUrl, userId, sessionId, tokenHash, index),
      ),
    )
    assert.equal(
      results.filter((result) => result === true).length,
      1,
      "exactly one concurrent consume should succeed",
    )
    assert.equal(
      results.filter((result) => result === false).length,
      workerCount - 1,
      "all competing consumes should return false",
    )

    const [row] = await sql`
      select count(*)::int as consumed_count
      from private.password_recovery_grants
      where token_hash = ${tokenHash}
        and consumed_at is not null
    `
    assert.equal(row.consumed_count, 1, "grant should be marked consumed once")
    console.log(
      JSON.stringify({
        scenario: "Todo3 live auth recovery grant concurrent atomic consume",
        tokenHashPrefix: tokenHash.slice(0, 8),
        workerCount,
        successes: 1,
      }),
    )
  } finally {
    await sql`delete from private.password_recovery_grants where token_hash = ${tokenHash}`
    await sql`delete from auth.users where id = ${userId}`
    await sql.end({ timeout: 1 })
  }
}

async function createAuthUser(sql, userId) {
  await sql`
    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      ${userId},
      'authenticated',
      'authenticated',
      ${`${userId}@todo3-recovery-grants.test`},
      '',
      statement_timestamp(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      statement_timestamp(),
      statement_timestamp()
    )
  `
}

async function consumeWorker(dbUrl, userId, sessionId, tokenHash, index) {
  const sql = postgres(withApplicationName(dbUrl, `spolink-todo3-grant-worker-${index}`), {
    idle_timeout: 1,
    max: 1,
  })
  try {
    return callGrantRpc(
      sql,
      userId,
      sessionId,
      (tx) => tx`
      select public.consume_password_recovery_grant(${tokenHash}) as ok
    `,
    )
  } finally {
    await sql.end({ timeout: 1 })
  }
}

async function callGrantRpc(sql, userId, sessionId, query) {
  const rows = await sql.begin(async (tx) => {
    await tx`
      select set_config(
        'request.jwt.claims',
        jsonb_build_object(
          'sub', ${userId}::uuid,
          'role', 'authenticated',
          'session_id', ${sessionId}::text
        )::text,
        true
      )
    `
    await tx`select set_config('request.jwt.claim.sub', ${userId}::text, true)`
    await tx`select set_config('request.jwt.claim.role', 'authenticated', true)`
    await tx`set local role authenticated`
    return query(tx)
  })
  const [row] = rows
  return row?.ok === true
}

function withApplicationName(dbUrl, applicationName) {
  const url = new URL(dbUrl)
  url.searchParams.set("application_name", applicationName)
  return url.toString()
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
