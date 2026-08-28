import assert from "node:assert/strict"
import test from "node:test"

import { createLessonImageFixtureNamespace } from "./fixture.mjs"
import { cleanupIsAllZero } from "./live/evidence.mjs"

test("distinct run ids create isolated deterministic users and lesson ids", () => {
  const first = createLessonImageFixtureNamespace("parallel-a")
  const repeated = createLessonImageFixtureNamespace("parallel-a")
  const second = createLessonImageFixtureNamespace("parallel-b")

  assert.deepEqual(first.users, repeated.users)
  assert.equal(first.nextId("lesson"), repeated.nextId("lesson"))
  assert.notDeepEqual(first.users, second.users)
  assert.notEqual(first.nextId("lesson"), second.nextId("lesson"))
})

test("cleanup allZero requires every owned resource count to be zero", () => {
  assert.equal(
    cleanupIsAllZero({ authUsers: 0, images: 0, intents: 0, lessons: 0, objects: 0, profiles: 0 }),
    true,
  )
  assert.equal(
    cleanupIsAllZero({ authUsers: 0, images: 0, intents: 1, lessons: 0, objects: 0, profiles: 0 }),
    false,
  )
})
