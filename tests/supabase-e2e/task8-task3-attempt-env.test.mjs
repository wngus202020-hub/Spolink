import assert from "node:assert/strict"
import test from "node:test"

import { buildChildEnv } from "./task8/helpers.mjs"

test("Todo8 forwards the explicit Task 3 attempt only to configured E2E children", () => {
  const parent = { HOME: "/home/test", PATH: "/bin", TMPDIR: "/tmp" }
  const attemptRoot = "/tmp/task-3-attempt"

  assert.deepEqual(
    buildChildEnv("e2e", parent, {
      baseUrl: "http://127.0.0.1:3006",
      SPOLINK_TASK3_ATTEMPT_DIR: attemptRoot,
    }),
    {
      ...parent,
      NODE_ENV: "test",
      SPOLINK_TASK3_ATTEMPT_DIR: attemptRoot,
      SPOLINK_TEST_BASE_URL: "http://127.0.0.1:3006",
    },
  )
  assert.equal(buildChildEnv("supabase-command", parent).SPOLINK_TASK3_ATTEMPT_DIR, undefined)
})
