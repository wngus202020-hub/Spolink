import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(fileURLToPath(new URL("../../../../", import.meta.url)))
const relativeCli =
  "tests/supabase-e2e/lesson-images/registration-security/rpc-boundary-security.mjs"
const absoluteCli = path.join(repoRoot, relativeCli)
const hook = fileURLToPath(new URL("./fixtures/scenario-hook.mjs", import.meta.url))
const successSentinel = "LESSON_IMAGE_RPC_BOUNDARY_SECURITY_OK observations=4"

for (const [label, cli] of [
  ["relative", relativeCli],
  ["absolute", absoluteCli],
]) {
  test(`Given a ${label} CLI path, when security observations complete, then success is explicit`, () => {
    const result = runCli(cli, "success")

    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, "")
    assert.match(result.stdout, new RegExp(`^${successSentinel}\\n$`, "u"))
  })
}

test("Given a no-op scenario, when the CLI finishes, then it fails without a success sentinel", () => {
  const result = runCli(relativeCli, "no-op")

  assert.notEqual(result.status, 0)
  assert.doesNotMatch(result.stdout, /LESSON_IMAGE_RPC_BOUNDARY_SECURITY_OK/u)
  assert.match(result.stderr, /expected semantic observations/u)
})

function runCli(cli, mode) {
  return spawnSync(process.execPath, ["--import", hook, cli], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, SPOLINK_RPC_BOUNDARY_FIXTURE_MODE: mode },
    timeout: 10_000,
  })
}
