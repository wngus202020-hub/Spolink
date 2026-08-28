import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

export const adminDashboardSourceRoots = Object.freeze([
  "app/admin/page.tsx",
  "lib/auth/route-security.ts",
  "lib/reservations/reservation-lifecycle-route-adapter.ts",
  "package.json",
  "tests/admin-dashboard-e2e-preflight.test.mjs",
  "tests/admin-dashboard-png-crc.test.mjs",
  "tests/api-contract-inventory.mjs",
  "tests/api-contract-runner.mjs",
  "tests/auth-ui-e2e/admin-dashboard-evidence.mjs",
  "tests/auth-ui-e2e/admin-dashboard-evidence.test.mjs",
  "tests/auth-ui-e2e/admin-dashboard-final-evidence.mjs",
  "tests/auth-ui-e2e/admin-dashboard-preflight-evidence.mjs",
  "tests/auth-ui-e2e/admin-dashboard-preflight-fixture.mjs",
  "tests/auth-ui-e2e/admin-dashboard-scenario.ts",
  "tests/auth-ui-e2e/run-task-10-ui-env.test.mjs",
  "tests/auth-ui-e2e/run-task-10-ui.mjs",
  "tests/auth-ui-e2e/task-10-ui.spec.ts",
  "tests/run-api-contracts.mjs",
])

const parsedExtensions = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"])
const moduleExtensions = [".mjs", ".js", ".ts", ".tsx", ".mts", ".cts", ".json", ".css"]

export async function resolveAdminDashboardSourcePaths({
  repoRoot = defaultRepoRoot,
  roots = adminDashboardSourceRoots,
} = {}) {
  const absoluteRoot = path.resolve(repoRoot)
  const pending = [...roots]
  const visited = new Set()
  while (pending.length > 0) {
    const relativePath = normalizeRelativePath(pending.pop(), absoluteRoot)
    if (visited.has(relativePath)) continue
    const absolutePath = path.join(absoluteRoot, relativePath)
    const details = await stat(absolutePath)
    if (!details.isFile()) throw new Error(`Source binding is not a file: ${relativePath}`)
    visited.add(relativePath)
    if (!parsedExtensions.has(path.extname(relativePath))) continue
    const source = await readFile(absolutePath, "utf8")
    for (const specifier of readModuleSpecifiers(source, relativePath)) {
      const dependency = await resolveLocalDependency({ absoluteRoot, relativePath, specifier })
      if (dependency) pending.push(dependency)
    }
  }
  return [...visited].sort()
}

function readModuleSpecifiers(source, filePath) {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
  const specifiers = []
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

async function resolveLocalDependency({ absoluteRoot, relativePath, specifier }) {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null
  const importerDir = path.dirname(path.join(absoluteRoot, relativePath))
  const base = specifier.startsWith("@/")
    ? path.join(absoluteRoot, specifier.slice(2))
    : path.resolve(importerDir, specifier)
  const candidates = moduleExtensions.includes(path.extname(base))
    ? [base, ...javascriptExtensionFallbacks(base)]
    : [
        base,
        ...moduleExtensions.map((extension) => `${base}${extension}`),
        ...moduleExtensions.map((extension) => path.join(base, `index${extension}`)),
      ]
  const matches = []
  for (const candidate of new Set(candidates)) {
    if (await isFile(candidate)) matches.push(candidate)
  }
  if (matches.length !== 1) {
    throw new Error(
      `Source binding import must resolve exactly once: ${relativePath} -> ${specifier} (${matches.length})`,
    )
  }
  return normalizeRelativePath(path.relative(absoluteRoot, matches[0]), absoluteRoot)
}

function javascriptExtensionFallbacks(filePath) {
  if (!filePath.endsWith(".js")) return []
  const withoutExtension = filePath.slice(0, -3)
  return [".ts", ".tsx", ".mts"].map((extension) => `${withoutExtension}${extension}`)
}

function normalizeRelativePath(filePath, absoluteRoot) {
  const relativePath = path.normalize(filePath)
  const absolutePath = path.resolve(absoluteRoot, relativePath)
  if (absolutePath === absoluteRoot || !absolutePath.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error(`Source binding escapes repository root: ${filePath}`)
  }
  return path.relative(absoluteRoot, absolutePath).split(path.sep).join("/")
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile()
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false
    throw error
  }
}
