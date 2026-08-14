import { createHash } from "node:crypto"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

const excludedDirs = new Set([
  ".codegraph",
  ".next",
  ".omo",
  ".supabase",
  "coverage",
  "node_modules",
  "out",
])
const excludedFiles = new Set([".DS_Store"])
const excludedSuffixes = [".swp", ".swo", ".tsbuildinfo"]

export async function readCurrentManifest(repoRoot = process.cwd()) {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"))
  return {
    developmentDependencies: dependencyList(packageJson.devDependencies ?? {}),
    lockfileSha256: await fileSha256(path.join(repoRoot, "pnpm-lock.yaml")),
    productionDependencies: dependencyList(packageJson.dependencies ?? {}),
    sourceFiles: await sourceFiles(repoRoot),
  }
}

export async function fileSha256(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex")
}

export function dependencyList(dependencies) {
  return Object.entries(dependencies)
    .map(([name, version]) => ({ name, version }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function diffSources(baseline, current) {
  const base = new Map(baseline.map((item) => [item.path, item.sha256]))
  const next = new Map(current.map((item) => [item.path, item.sha256]))
  const added = [...next.keys()].filter((item) => !base.has(item)).sort()
  const deleted = [...base.keys()].filter((item) => !next.has(item)).sort()
  const modified = [...next.keys()]
    .filter((item) => base.has(item) && base.get(item) !== next.get(item))
    .sort()
  return { added, deleted, modified }
}

async function sourceFiles(repoRoot) {
  const files = []
  await visit(repoRoot, "")
  return files.sort((left, right) => left.path.localeCompare(right.path))

  async function visit(root, rel) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!excludedDirs.has(entry.name)) await visit(path.join(root, entry.name), entryRel)
      } else if (entry.isFile() && includeFile(entry.name)) {
        files.push({ path: entryRel, sha256: await fileSha256(path.join(repoRoot, entryRel)) })
      }
    }
  }
}

function includeFile(name) {
  if (excludedFiles.has(name) || name.startsWith("._") || name.endsWith("~")) return false
  return !excludedSuffixes.some((suffix) => name.endsWith(suffix))
}

export async function fileExists(filePath) {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}
