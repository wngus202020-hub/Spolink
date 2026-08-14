import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export async function createCredentialManifestPath(manifestPath) {
  if (manifestPath) return { path: manifestPath, tempDir: null }
  const dir = await mkdtemp(path.join(os.tmpdir(), "spolink-supabase-e2e-"))
  return { path: path.join(dir, "credentials.json"), tempDir: dir }
}

export async function removeCredentialManifest(credentialManifest) {
  await rm(credentialManifest.path, { force: true })
  if (credentialManifest.tempDir?.startsWith(path.join(os.tmpdir(), "spolink-supabase-e2e-"))) {
    await rm(credentialManifest.tempDir, { recursive: true, force: true })
  }
}
