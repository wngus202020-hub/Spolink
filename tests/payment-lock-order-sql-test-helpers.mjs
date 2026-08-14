import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const migrationPath = new URL(
  "../supabase/migrations/20260712000000_mvp_schema.sql",
  import.meta.url,
)

export async function readPaymentFunction(functionName) {
  const sql = await readFile(migrationPath, "utf8")
  const startMarker = `create or replace function public.${functionName}`
  const endMarker = `revoke all on function public.${functionName}`
  const functionStart = sql.indexOf(startMarker)
  const functionEnd = sql.indexOf(endMarker, functionStart)

  assert.notEqual(functionStart, -1, `${functionName} function start is missing`)
  assert.notEqual(functionEnd, -1, `${functionName} function end is missing`)

  return sql.slice(functionStart, functionEnd)
}

export function extractRowLockSequence(functionSql) {
  return functionSql
    .split(";")
    .filter((statement) => /\bfor\s+update\b/i.test(statement))
    .map((statement) => {
      const tableMatch = statement.match(
        /\bfrom\s+public\.(reservations|payments|lesson_schedules)\b/i,
      )

      assert.notEqual(tableMatch, null, `unparsed row lock statement: ${statement.trim()}`)
      return tableMatch[1]
    })
}
