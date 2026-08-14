import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import test from "node:test"

import {
  assertNextTypeState,
  expectedDevRouteImport,
  readNextTypeState,
  restoreNextDevRouteReference,
} from "./next-type-stability.mjs"

const productionRouteImport = 'import "./.next/types/routes.d.ts";'

test("restores Next build route import while preserving tsconfig hash", async () => {
  const original = await readFile("next-env.d.ts", "utf8")
  const before = await readNextTypeState()
  try {
    await writeFile(
      "next-env.d.ts",
      original.replace(expectedDevRouteImport, productionRouteImport),
      "utf8",
    )
    const restored = await restoreNextDevRouteReference()
    assert.equal(restored.changed, true)
    const after = await assertNextTypeState(process.cwd(), before.tsconfigSha256)
    assert.equal(after.line3, expectedDevRouteImport)
    assert.equal(after.tsconfigSha256, before.tsconfigSha256)
  } finally {
    await writeFile("next-env.d.ts", original, "utf8")
    await restoreNextDevRouteReference()
  }
})
