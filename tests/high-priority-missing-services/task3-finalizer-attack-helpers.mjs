import assert from "node:assert/strict"
import { mkdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises"
import path from "node:path"

import * as task3Finalizer from "./finalize-task3.mjs"
import { contractAttemptRoot, createFixture, sentinel, sha256 } from "./task3-evidence-fixtures.mjs"

export async function runFinalizer(receiptsDir, outputPath) {
  await rm(outputPath, { force: true })
  try {
    const evidence = await task3Finalizer.finalizeTask3EvidenceForTest(
      { receiptsDir },
      testDependencies(outputPath),
    )
    return { exitCode: 0, stderr: "", stdout: JSON.stringify(evidence) }
  } catch (error) {
    return { exitCode: 1, stderr: error instanceof Error ? error.message : "unknown", stdout: "" }
  }
}

export function runInjectedFinalizer(receiptsDir, outputPath, beforePublish = async () => {}) {
  return task3Finalizer.finalizeTask3EvidenceForTest(
    { receiptsDir },
    { ...testDependencies(outputPath), beforePublish },
  )
}

export function attemptOutput(name) {
  return path.join(contractAttemptRoot, `task-1-finalizer-${name}-${process.pid}.json`)
}

export async function replaceSameBytes(target) {
  const replacement = `${target}.replacement`
  await writeFile(replacement, await readFile(target), { mode: 0o600 })
  await rename(replacement, target)
}

export async function assertParentSwapAttacks(source) {
  for (const attack of ["replacement", "symlink"])
    for (const publication of ["attempt", "canonical"])
      await assertParentSwap(source, attack, publication)
}

async function assertParentSwap(source, attack, publication) {
  const fixture = await createFixture(`parent-swap-${attack}-${publication}`, source)
  const outputPath = attemptOutput(`parent-swap-${attack}-${publication}`)
  const displacedRoot = `${contractAttemptRoot}.displaced-${attack}-${publication}`
  const attackerRoot = `${contractAttemptRoot}.attacker-${attack}-${publication}`
  const trustedIdentity = await stat(contractAttemptRoot)
  let attackerIdentity
  let attackRan = false
  await rm(outputPath, { force: true })
  if (publication === "canonical") await writeFile(outputPath, sentinel, { mode: 0o600 })
  try {
    await assert.rejects(
      task3Finalizer.finalizeTask3EvidenceForTest(
        { receiptsDir: fixture.root },
        {
          ...testDependencies(outputPath),
          publication,
          beforePublication: async () => {
            await rename(contractAttemptRoot, displacedRoot)
            if (attack === "symlink") {
              await mkdir(attackerRoot, { mode: 0o700 })
              await symlink(attackerRoot, contractAttemptRoot)
            } else await mkdir(contractAttemptRoot, { mode: 0o700 })
            if (publication === "canonical") await writeFile(outputPath, sentinel, { mode: 0o600 })
            attackerIdentity = await stat(contractAttemptRoot)
            attackRan = true
          },
        },
      ),
      /output directory identity drifted after publication|must be a real directory/,
    )
    assert.equal(attackRan, true)
    const displacedIdentity = await stat(displacedRoot)
    assert.equal(displacedIdentity.ino, trustedIdentity.ino)
    assert.equal(displacedIdentity.dev, trustedIdentity.dev)
    assert.notEqual(attackerIdentity.ino, trustedIdentity.ino)
    const anchored = JSON.parse(
      await readFile(path.join(displacedRoot, path.basename(outputPath)), "utf8"),
    )
    assert.equal(anchored.status, "verified")
    if (publication === "attempt") await assert.rejects(readFile(outputPath), { code: "ENOENT" })
    else assert.equal(sha256(await readFile(outputPath)), sha256(sentinel))
  } finally {
    if (attackRan) {
      await rm(contractAttemptRoot, { force: true, recursive: true })
      await rename(displacedRoot, contractAttemptRoot)
      await rm(attackerRoot, { force: true, recursive: true })
    }
    await rm(outputPath, { force: true })
  }
}

function testDependencies(outputPath) {
  return {
    attemptRoot: contractAttemptRoot,
    beforePublish: async () => {},
    beforePublication: async () => {},
    outputPath,
    publication: "attempt",
  }
}
