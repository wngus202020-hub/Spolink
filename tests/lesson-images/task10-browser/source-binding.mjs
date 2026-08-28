import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

import { runCapture } from "./process-runner.mjs"

const roots = ["app", "components", "lib", "public/images", "tests/lesson-images"]
const explicitFiles = [
  "next.config.ts",
  "package.json",
  "pnpm-lock.yaml",
  "postcss.config.mjs",
  "proxy.ts",
  "tests/lesson-authoring-browser-qa-support.mjs",
  "tests/supabase-e2e/local-status.mjs",
  "tests/supabase-e2e/next-server.mjs",
  "tsconfig.json",
]
const requiredVisualDependencies = [
  "app/globals.css",
  "app/layout.tsx",
  "components/home/lesson-card-media.tsx",
  "components/layout/public-header.tsx",
  "components/ui/button.tsx",
  "next.config.ts",
  "package.json",
  "pnpm-lock.yaml",
  "postcss.config.mjs",
  "public/images/lesson-pilates.svg",
  "public/images/lesson-pilates.webp",
  "public/images/lesson-running.svg",
  "public/images/lesson-running.webp",
  "public/images/lesson-tennis.svg",
  "public/images/lesson-tennis.webp",
  "proxy.ts",
]

export async function captureSourceBinding(repoRoot) {
  const files = []
  for (const root of roots) await collectFiles(path.join(repoRoot, root), files)
  files.push(...explicitFiles.map((file) => path.join(repoRoot, file)))
  const entries = await Promise.all(
    [...new Set(files)].sort().map(async (file) => ({
      bytes: (await stat(file)).size,
      path: path.relative(repoRoot, file),
      sha256: sha256(await readFile(file)),
    })),
  )
  const boundPaths = new Set(entries.map((entry) => entry.path))
  for (const required of requiredVisualDependencies) {
    assert.equal(boundPaths.has(required), true, `source binding missing ${required}`)
  }
  const gitHead = (await runCapture("git", ["rev-parse", "HEAD"])).trim()
  return {
    aggregateSha256: sha256(entries.map((entry) => `${entry.path}\0${entry.sha256}\n`).join("")),
    coverage: {
      explicitFiles,
      requiredVisualDependencies,
      roots,
      strategy: "Complete visual/runtime source superset for rendered app surfaces",
    },
    entries,
    gitHead,
  }
}

export function compareSourceBindings(before, after) {
  const beforeByPath = new Map(before.entries.map((entry) => [entry.path, entry.sha256]))
  const afterByPath = new Map(after.entries.map((entry) => [entry.path, entry.sha256]))
  const added = [...afterByPath.keys()].filter((file) => !beforeByPath.has(file)).sort()
  const removed = [...beforeByPath.keys()].filter((file) => !afterByPath.has(file)).sort()
  const changed = [...beforeByPath].flatMap(([file, digest]) =>
    afterByPath.has(file) && afterByPath.get(file) !== digest ? [file] : [],
  )
  return {
    added,
    afterAggregateSha256: after.aggregateSha256,
    beforeAggregateSha256: before.aggregateSha256,
    changed,
    driftCount: added.length + removed.length + changed.length,
    gitHeadMatch: before.gitHead === after.gitHead,
    removed,
  }
}

async function collectFiles(directory, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) await collectFiles(target, files)
    else if (entry.isFile()) files.push(target)
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
