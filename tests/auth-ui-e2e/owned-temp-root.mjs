import { randomBytes } from "node:crypto"
import {
  chmod,
  lstat,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  assertDirectoryInventory,
  assertIdentity,
  assertRealpathChild,
  captureDirectoryInventory,
  childNamePath,
  readIdentity,
  validateChildPath,
} from "./owned-temp-inventory.mjs"

const ownerFileName = ".spolink-temp-owner"
const handleState = new WeakMap()

export async function createOwnedTempRoot({ parent = os.tmpdir(), prefix }) {
  if (!/^[a-z0-9][a-z0-9-]*-$/u.test(prefix)) throw new Error("Owned temp prefix is invalid")
  const root = await realpath(await mkdtemp(path.join(parent, prefix)))
  await chmod(root, 0o700)
  const token = randomBytes(32).toString("hex")
  const ownerPath = path.join(root, ownerFileName)
  await writeFile(ownerPath, `${token}\n`, { flag: "wx", mode: 0o600 })
  const rootIdentity = await readIdentity(root, "directory")
  const ownerIdentity = await readIdentity(ownerPath, "file")
  const registrations = new Map()
  let expectedRootNlink = rootIdentity.nlink
  let closed = false

  async function assertOwner({ checkNlink = true } = {}) {
    if (closed) throw new Error("Owned temp root is closed")
    const currentRoot = await readIdentity(root, "directory")
    assertIdentity(currentRoot, rootIdentity, "Owned temp root identity")
    if ((currentRoot.mode & 0o777) !== 0o700) throw new Error("Owned temp root mode changed")
    if (checkNlink && currentRoot.nlink !== expectedRootNlink) {
      throw new Error("Owned temp root link topology changed")
    }
    const currentOwner = await readIdentity(ownerPath, "file")
    assertIdentity(currentOwner, ownerIdentity, "Owned temp ownership token")
    if ((currentOwner.mode & 0o777) !== 0o600 || currentOwner.nlink !== 1) {
      throw new Error("Owned temp ownership token mode or link count changed")
    }
    const handle = await open(ownerPath, "r")
    try {
      if ((await handle.readFile("utf8")) !== `${token}\n`) {
        throw new Error("Owned temp ownership token changed")
      }
    } finally {
      await handle.close()
    }
    return currentRoot
  }

  async function register(candidate) {
    const resolved = validateChildPath(root, candidate)
    if (registrations.has(resolved)) throw new Error("Owned temp child is already registered")
    throw new Error("Owned temp children must be created by their task root")
  }

  async function registerCreated(resolved) {
    const identity = await readIdentity(resolved)
    if (identity.symlink) throw new Error("Owned temp child must not be a symlink")
    if (!identity.file && !identity.directory) {
      throw new Error("Owned temp child must be a regular file or directory")
    }
    if (identity.file && identity.nlink !== 1) {
      throw new Error("Owned temp child hardlink count is unexpected")
    }
    await assertOwner({ checkNlink: false })
    await assertRealpathChild(root, resolved)
    await sealRootTopology([resolved])
    const handle = Object.freeze({ path: resolved })
    const state = {
      directoryInventory: identity.directory ? new Map() : null,
      directoryInventorySealed: false,
      identity,
      owner: api,
      path: resolved,
    }
    handleState.set(handle, state)
    registrations.set(resolved, state)
    return handle
  }

  async function createDirectory(name) {
    await assertOwner()
    const childPath = childNamePath(root, name)
    const { mkdir } = await import("node:fs/promises")
    await mkdir(childPath, { mode: 0o700 })
    return registerCreated(childPath)
  }

  async function createFile(name, bytes = "") {
    await assertOwner()
    const childPath = childNamePath(root, name)
    await writeFile(childPath, bytes, { flag: "wx", mode: 0o600 })
    return registerCreated(childPath)
  }

  async function remove(handle) {
    await assertOwner()
    await assertSealedRootInventory()
    const state = requireHandle(handle, api, registrations)
    const current = await readIdentity(state.path)
    if (current.symlink) throw new Error("Owned temp child was replaced by a symlink")
    assertIdentity(current, state.identity, "Owned temp child identity")
    if ((current.mode & 0o777) !== (state.identity.mode & 0o777)) {
      throw new Error("Owned temp child mode changed")
    }
    if (current.nlink !== state.identity.nlink) {
      throw new Error("Owned temp child link topology changed")
    }
    await assertRealpathChild(root, state.path)
    if (current.directory) {
      await assertDirectoryInventory(state.path, state.directoryInventory)
    }
    await rm(state.path, { recursive: current.directory })
    registrations.delete(state.path)
    const currentRoot = await assertOwner({ checkNlink: false })
    expectedRootNlink = currentRoot.nlink
  }

  async function abandon(handle) {
    const state = requireHandle(handle, api, registrations)
    try {
      await lstat(state.path)
      throw new Error("Owned temp child must be absent before abandoning its handle")
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
    registrations.delete(state.path)
    await sealRootTopology()
  }

  async function cleanup() {
    await assertOwner()
    if (registrations.size > 0) throw new Error("Owned temp root still has registered children")
    const entries = await readdir(root)
    if (entries.length !== 1 || entries[0] !== ownerFileName) {
      throw new Error("Owned temp root contains unregistered paths")
    }
    await rm(ownerPath)
    await rmdir(root)
    closed = true
  }

  async function sealDirectory(handle) {
    await assertOwner()
    const state = requireHandle(handle, api, registrations)
    if (!state.identity.directory) throw new Error("Owned temp child is not a directory")
    if (state.directoryInventorySealed) {
      throw new Error("Owned temp directory inventory is already sealed")
    }
    await assertSealedRootInventory({ allowNlinkPath: state.path })
    const current = await readIdentity(state.path, "directory")
    assertIdentity(current, state.identity, "Owned temp child identity")
    if (current.mode !== state.identity.mode) throw new Error("Owned temp child mode changed")
    await assertRealpathChild(root, state.path)
    state.directoryInventory = await captureDirectoryInventory(state.path)
    state.directoryInventorySealed = true
    state.identity = current
  }

  const api = Object.freeze({
    abandon,
    cleanup,
    createDirectory,
    createFile,
    register,
    remove,
    root,
    sealDirectory,
  })
  return api

  async function sealRootTopology(additionalPaths = []) {
    const currentRoot = await assertOwner({ checkNlink: false })
    const expectedEntries = [
      ownerFileName,
      ...[...registrations.keys()].map((entry) => path.basename(entry)),
      ...additionalPaths.map((entry) => path.basename(entry)),
    ].sort()
    const actualEntries = (await readdir(root)).sort()
    if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
      throw new Error("Owned temp root contains unregistered topology")
    }
    expectedRootNlink = currentRoot.nlink
  }

  async function assertSealedRootInventory({ allowNlinkPath = null } = {}) {
    const states = [...registrations.values()]
    const expectedEntries = [
      ownerFileName,
      ...states.map((state) => path.basename(state.path)),
    ].sort()
    if (JSON.stringify((await readdir(root)).sort()) !== JSON.stringify(expectedEntries)) {
      throw new Error("Owned temp root contains unregistered topology")
    }
    for (const state of states) {
      const current = await readIdentity(state.path)
      assertIdentity(current, state.identity, "Owned temp child identity")
      if (
        current.file !== state.identity.file ||
        current.directory !== state.identity.directory ||
        current.mode !== state.identity.mode ||
        (state.path !== allowNlinkPath && current.nlink !== state.identity.nlink)
      ) {
        throw new Error("Owned temp child type, mode, or link count changed")
      }
      await assertRealpathChild(root, state.path)
    }
  }
}

function requireHandle(handle, owner, registrations) {
  if (!handle || typeof handle !== "object") throw new Error("Owned temp handle is required")
  const state = handleState.get(handle)
  if (!state || state.owner !== owner) throw new Error("Owned temp handle is unregistered")
  if (registrations.get(state.path) !== state)
    throw new Error("Owned temp handle is not registered")
  return state
}
