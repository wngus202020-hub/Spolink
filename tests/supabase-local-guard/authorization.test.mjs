import assert from "node:assert/strict"
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { DIRECT_TRIGGER, readInstallAuthorization } from "../../scripts/supabase-local.mjs"

test("install authorization rejects a final-component symbolic link with the install-authorization mode error", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
  try {
    const targetPath = path.join(dir, "authorization-target.json")
    const authorizationPath = path.join(dir, "authorization.json")
    await writeFile(
      targetPath,
      JSON.stringify({
        schemaVersion: 1,
        triggeringCommand: DIRECT_TRIGGER,
        requestedInstallerAction: "brew install --cask docker",
        runId: "run-install-authorization",
        authorizedAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    )
    await chmod(targetPath, 0o600)
    await symlink(targetPath, authorizationPath)
    await assert.rejects(readInstallAuthorization(authorizationPath), {
      message: "Docker install authorization must be mode 0600",
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
