import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const sourceNames = [
  "read-data.ts",
  "read-model.ts",
  "read-presentation.ts",
  "read-query.ts",
  "read-types.ts",
]
const workspaces = []
const cache = new Map()

process.once("exit", () => {
  for (const workspace of workspaces) rmSync(workspace, { force: true, recursive: true })
})

export async function importReviewModel(name, transforms = {}) {
  return importCompiled("read-model", name, transforms)
}

export async function importReviewQuery(name, transforms = {}) {
  return importCompiled("read-query", name, transforms)
}

async function importCompiled(moduleName, name, transforms = {}) {
  const transformKey = Object.entries(transforms)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, transform]) => `${file}:${transform.toString()}`)
    .join("|")
  const key = `${moduleName}:${transformKey}`
  let output = cache.get(key)
  if (!output) {
    output = compile(transforms)
    cache.set(key, output)
  }
  const loaded = await import(
    `${pathToFileURL(path.join(output, "lib/reviews", `${moduleName}.js`)).href}?case=${encodeURIComponent(name)}`
  )
  return loaded.default
}

function compile(transforms) {
  const workspace = mkdtempSync(path.join(tmpdir(), "spolink-review-read-"))
  const output = path.join(workspace, "dist")
  const sourceRoot = path.join(workspace, "source")
  const reviewRoot = path.join(sourceRoot, "lib/reviews")
  workspaces.push(workspace)
  mkdirSync(reviewRoot, { recursive: true })
  for (const sourceName of sourceNames) {
    const original = readFileSync(path.join(root, "lib/reviews", sourceName), "utf8")
    const transform = transforms[sourceName]
    writeFileSync(path.join(reviewRoot, sourceName), transform ? transform(original) : original)
  }
  const config = path.join(workspace, "tsconfig.json")
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        esModuleInterop: true,
        module: "CommonJS",
        moduleResolution: "Node",
        noEmit: false,
        noCheck: true,
        outDir: output,
        rootDir: sourceRoot,
        skipLibCheck: true,
        strict: true,
        target: "ES2022",
      },
      files: [path.join(reviewRoot, "read-model.ts")],
    }),
    { mode: 0o600 },
  )
  execFileSync(path.join(root, "node_modules/.bin/tsc"), ["--project", config], {
    cwd: root,
    stdio: "pipe",
  })
  writeRuntimeStubs(output)
  return output
}

function writeRuntimeStubs(output) {
  const packageRoot = path.join(output, "node_modules/@/lib")
  mkdirSync(path.join(packageRoot, "auth"), { recursive: true })
  mkdirSync(path.join(packageRoot, "supabase"), { recursive: true })
  writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ type: "commonjs" }))
  const runtime = "globalThis[Symbol.for('spolink.review-query-runtime')]"
  writeFileSync(
    path.join(packageRoot, "auth/server-profile.js"),
    `exports.createSupabaseServerComponentClient = async () => ${runtime}.ownerClient;`,
  )
  writeFileSync(
    path.join(packageRoot, "supabase/server.js"),
    `exports.createSupabaseServiceClient = () => ${runtime}.createServiceClient();`,
  )
}
