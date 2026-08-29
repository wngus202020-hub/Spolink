import assert from "node:assert/strict"
import test from "node:test"

import { buildNextChildEnv } from "./lifecycle-child.mjs"

const requiredParentEnv = {
  HOME: "/tmp/home",
  PATH: "/usr/bin",
  TMPDIR: "/tmp",
}
const localStatus = {
  anonKey: "local-anon-key",
  apiUrl: "http://127.0.0.1:54321",
  serviceRoleKey: "local-service-role-key",
}

test("coach fixture lifecycle enables application and dashboard server gates together", () => {
  const childEnv = buildNextChildEnv(requiredParentEnv, localStatus, true)

  assert.equal(childEnv.SPOLINK_COACH_UI_FIXTURES, "enabled")
  assert.equal(childEnv.SPOLINK_COACH_DASHBOARD_UI_FIXTURES, "enabled")
  assert.equal("NEXT_PUBLIC_SPOLINK_COACH_UI_FIXTURES" in childEnv, false)
  assert.equal("NEXT_PUBLIC_SPOLINK_COACH_DASHBOARD_UI_FIXTURES" in childEnv, false)
})

test("ordinary lifecycle strips stale inherited coach fixture gates", () => {
  const childEnv = buildNextChildEnv(
    {
      ...requiredParentEnv,
      SPOLINK_COACH_DASHBOARD_UI_FIXTURES: "enabled",
      SPOLINK_COACH_UI_FIXTURES: "enabled",
    },
    localStatus,
    false,
  )

  assert.equal("SPOLINK_COACH_UI_FIXTURES" in childEnv, false)
  assert.equal("SPOLINK_COACH_DASHBOARD_UI_FIXTURES" in childEnv, false)
})
