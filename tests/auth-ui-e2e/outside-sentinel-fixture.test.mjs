import assert from "node:assert/strict"
import { access, rm } from "node:fs/promises"
import test from "node:test"

import { withOutsideSentinelFixture } from "./outside-sentinel-fixture.mjs"

test("outside sentinel fixture is removed when its callback fails", async () => {
  let outside
  try {
    await assert.rejects(
      withOutsideSentinelFixture("callback-failure", async (fixture) => {
        outside = fixture.outside
        throw new Error("injected callback failure")
      }),
      /injected callback failure/u,
    )
    await assert.rejects(() => access(outside), /ENOENT/u)
  } finally {
    if (outside) await rm(outside, { force: true, recursive: true })
  }
})
