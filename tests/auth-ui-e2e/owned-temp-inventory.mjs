import { lstat, readdir, readlink, realpath } from "node:fs/promises"
import path from "node:path"

export function childNamePath(root, name) {
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name)) throw new Error("Owned temp child name is invalid")
  return validateChildPath(root, path.join(root, name))
}

export function validateChildPath(root, candidate) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) {
    throw new Error("Owned temp child path must be absolute")
  }
  const resolved = path.resolve(candidate)
  const relative = path.relative(root, resolved)
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Path is not an owned temp child")
  }
  if (relative.includes(path.sep)) {
    throw new Error("Owned temp child must be directly under its task root")
  }
  return resolved
}

export async function assertRealpathChild(root, candidate) {
  const actualRoot = await realpath(root)
  const actual = await realpath(candidate)
  if (path.dirname(actual) !== actualRoot) throw new Error("Owned temp child realpath escaped root")
}

export async function readIdentity(candidate, expectedType) {
  const stats = await lstat(candidate)
  const identity = identityFromStats(stats)
  if (identity.symlink) throw new Error("Owned temp path contains a symlink")
  if (expectedType && !identity[expectedType]) {
    throw new Error(`Owned temp ${expectedType} has unexpected type`)
  }
  return identity
}

export function assertIdentity(current, expected, label) {
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new Error(`${label} changed`)
  }
}

export async function captureDirectoryInventory(directory) {
  const inventory = new Map()
  for (const name of (await readdir(directory)).sort()) {
    const entryPath = path.join(directory, name)
    const stats = await lstat(entryPath)
    const identity = identityFromStats(stats)
    if (!identity.file && !identity.directory && !identity.symlink) {
      throw new Error("Owned temp directory contains an unsupported node")
    }
    inventory.set(name, {
      directory: identity.directory,
      file: identity.file,
      linkTarget: identity.symlink ? await readlink(entryPath) : null,
      mode: identity.mode,
      nlink: identity.file ? identity.nlink : null,
      symlink: identity.symlink,
    })
  }
  return inventory
}

export async function assertDirectoryInventory(directory, expected) {
  const current = await captureDirectoryInventory(directory)
  if (JSON.stringify([...current.keys()]) !== JSON.stringify([...expected.keys()])) {
    throw new Error("Owned temp directory contains unregistered nested topology")
  }
  for (const [name, expectedIdentity] of expected) {
    const currentIdentity = current.get(name)
    if (
      !currentIdentity ||
      Object.keys(expectedIdentity).some((key) => currentIdentity[key] !== expectedIdentity[key])
    ) {
      throw new Error("Owned temp nested entry identity or topology changed")
    }
  }
}

function identityFromStats(stats) {
  return {
    dev: stats.dev,
    directory: stats.isDirectory(),
    file: stats.isFile(),
    ino: stats.ino,
    mode: stats.mode,
    nlink: stats.nlink,
    symlink: stats.isSymbolicLink(),
  }
}
