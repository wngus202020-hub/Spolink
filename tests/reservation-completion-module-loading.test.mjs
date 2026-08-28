import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const projectRoot = fileURLToPath(new URL("..", import.meta.url))
const require = createRequire(import.meta.url)
const reservationId = "00000000-0000-4000-8000-000000000401"
const learnerId = "00000000-0000-4000-8000-000000000001"

test("Given emitted completion data, when Node loads and invokes it, then its runtime module graph resolves", async () => {
  // Given
  const workspace = await mkdtemp(path.join(tmpdir(), "spolink-completion-module-"))
  const outputDirectory = path.join(workspace, "dist")
  const configPath = path.join(workspace, "tsconfig.json")

  try {
    await writeFile(
      configPath,
      JSON.stringify({
        compilerOptions: {
          baseUrl: projectRoot,
          module: "CommonJS",
          moduleResolution: "Node",
          noEmit: false,
          outDir: outputDirectory,
          paths: { "@/*": [path.join(projectRoot, "*")] },
          rootDir: projectRoot,
          skipLibCheck: true,
          target: "ES2022",
        },
        files: [path.join(projectRoot, "lib/reservations/completion-page-data.ts")],
      }),
      { mode: 0o600 },
    )
    execFileSync(path.join(projectRoot, "node_modules/.bin/tsc"), ["--project", configPath], {
      cwd: projectRoot,
      stdio: "inherit",
    })

    // When
    const completionModule = require(
      path.join(outputDirectory, "lib/reservations/completion-page-data.js"),
    )
    const result = await completionModule.readReservationCompletionPageData(
      reservationId,
      learnerId,
      async () => ({ kind: "not_found" }),
      new Date("2026-08-01T00:00:00.000Z"),
    )

    // Then
    assert.deepEqual(result, { state: "not_found", viewModel: null })
  } finally {
    await rm(workspace, { force: true, recursive: true })
  }
})
