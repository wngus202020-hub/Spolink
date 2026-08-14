import assert from "node:assert/strict"
import { stat } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const packageManifest = require("../package.json")

test("runtime manifest keeps local UI primitives free of displaced UI dependencies", async () => {
  // Given: the runtime package manifest and local primitive entry points.
  const declaredDependencies = {
    ...packageManifest.dependencies,
    ...packageManifest.devDependencies,
  }
  const primitives = ["components/ui/button.tsx", "components/ui/status-badge.tsx"]

  // When: the declared dependency boundary and primitive files are inspected.
  const primitiveStats = await Promise.all(
    primitives.map((primitive) => stat(new URL(`../${primitive}`, import.meta.url))),
  )

  // Then: this runtime uses its local primitives without the displaced UI packages.
  for (const dependency of [
    "@radix-ui/react-dialog",
    "class-variance-authority",
    "tailwind-merge",
  ]) {
    assert.equal(Object.hasOwn(declaredDependencies, dependency), false, `${dependency} is absent`)
  }
  assert.ok(primitiveStats.every((primitive) => primitive.isFile() && primitive.size > 0))
})
