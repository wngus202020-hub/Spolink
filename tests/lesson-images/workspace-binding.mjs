import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { lstat, readFile, readlink } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const MAX_GIT_OUTPUT_BYTES = 256 * 1024 * 1024
const utf8Decoder = new TextDecoder("utf-8", { fatal: true })

export async function createWorkspaceBinding(repoPath = ".", repositoryArgument = ".") {
  const repoRoot = await resolveRepoRoot(repoPath)
  const [headOutput, statusOutput, trackedDiffOutput, untrackedOutput] = await Promise.all([
    runGit(repoRoot, ["rev-parse", "HEAD"]),
    runGit(repoRoot, ["status", "--porcelain=v1", "-z"]),
    runGit(repoRoot, ["diff", "--binary", "--no-ext-diff", "--no-textconv", "HEAD"]),
    runGit(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ])
  const untrackedManifest = await createUntrackedManifest(repoRoot, untrackedOutput)

  return {
    algorithm: {
      canonicalJson:
        "UTF-8 JSON with recursively lexicographically sorted object keys and one trailing LF",
      hash: "SHA-256 over raw command output or canonical manifest bytes",
      headCommand: ["git", "rev-parse", "HEAD"],
      porcelainStatusCommand: ["git", "status", "--porcelain=v1", "-z"],
      trackedDiffCommand: ["git", "diff", "--binary", "--no-ext-diff", "--no-textconv", "HEAD"],
      untrackedCommand: ["git", "ls-files", "--others", "--exclude-standard", "-z"],
      untrackedEntry:
        "Git NUL path, strict UTF-8, normalized repo-relative POSIX path, lstat mode, content byte size, SHA-256; symlinks hash readlink target bytes",
      untrackedSort: "ascending raw UTF-8 path bytes",
    },
    invocation: ["node", "tests/lesson-images/workspace-binding.mjs", "--repo", repositoryArgument],
    schema: "spolink.workspace-binding",
    source: {
      head: readGitLine(headOutput),
      porcelainStatusV1ZSha256: sha256(statusOutput),
      trackedDiffBinarySha256: sha256(trackedDiffOutput),
      untrackedManifestSha256: sha256(canonicalJson(untrackedManifest)),
    },
    untrackedManifest,
    version: 1,
  }
}

export function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(canonicalize(value))}\n`, "utf8")
}

export function serializeWorkspaceBinding(binding) {
  return canonicalJson(binding)
}

async function resolveRepoRoot(repoPath) {
  const output = await runGit(process.cwd(), [
    "-C",
    path.resolve(repoPath),
    "rev-parse",
    "--show-toplevel",
  ])
  return readGitLine(output)
}

async function runGit(repoRoot, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  })
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
}

async function createUntrackedManifest(repoRoot, output) {
  const entries = await Promise.all(
    parseNulPaths(output).map(async (rawPath) => {
      const relativePath = normalizeRelativePath(rawPath)
      const absolutePath = path.resolve(repoRoot, ...relativePath.split("/"))
      const stats = await lstat(absolutePath)
      const content = await readEntryContent(absolutePath, stats)
      return {
        byteSize: content.byteLength,
        mode: (stats.mode & 0o177777).toString(8).padStart(6, "0"),
        path: relativePath,
        sha256: sha256(content),
        rawPath,
      }
    }),
  )

  entries.sort((left, right) => Buffer.compare(left.rawPath, right.rawPath))
  return {
    entries: entries.map(({ rawPath: _rawPath, ...entry }) => entry),
    schema: "spolink.untracked-worktree-manifest",
    version: 1,
  }
}

function parseNulPaths(output) {
  if (output.length === 0) return []
  if (output.at(-1) !== 0) throw new Error("git ls-files NUL output is malformed")

  const paths = []
  let start = 0
  for (let end = output.indexOf(0, start); end !== -1; end = output.indexOf(0, start)) {
    paths.push(output.subarray(start, end))
    start = end + 1
  }
  return paths
}

function normalizeRelativePath(rawPath) {
  const relativePath = utf8Decoder.decode(rawPath)
  const normalizedPath = path.posix.normalize(relativePath)
  if (
    !relativePath ||
    path.posix.isAbsolute(relativePath) ||
    normalizedPath === "." ||
    normalizedPath === ".." ||
    normalizedPath.startsWith("../")
  ) {
    throw new Error("git returned an unsafe repository-relative path")
  }
  return normalizedPath
}

async function readEntryContent(absolutePath, stats) {
  if (stats.isFile()) return readFile(absolutePath)
  if (stats.isSymbolicLink()) {
    const target = await readlink(absolutePath, "buffer")
    return Buffer.isBuffer(target) ? target : Buffer.from(target)
  }
  throw new Error(`untracked manifest only supports files and symbolic links: ${absolutePath}`)
}

function readGitLine(output) {
  return output.toString("ascii").replace(/\n$/u, "")
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    )
  }
  return value
}

function parseCliArguments(arguments_) {
  if (arguments_.length === 0) return "."
  if (arguments_.length === 2 && arguments_[0] === "--repo") return arguments_[1]
  throw new Error("Usage: node tests/lesson-images/workspace-binding.mjs [--repo <path>]")
}

async function main() {
  const repositoryArgument = parseCliArguments(process.argv.slice(2))
  const binding = await createWorkspaceBinding(repositoryArgument, repositoryArgument)
  process.stdout.write(serializeWorkspaceBinding(binding))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    process.exitCode = 1
  })
}
