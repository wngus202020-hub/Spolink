#!/usr/bin/env node
import { readFile } from "node:fs/promises"

import { fixedIds } from "./fixtures.mjs"
import {
  assertCancellationBody,
  assertConfiguredBody,
  assertMetadata,
  assertUnauthorizedBody,
} from "./task8/qa-assertions.mjs"
import { assertQaState } from "./task8/qa-db.mjs"
import { readMetadataValue, release, waitForMetadata } from "./task8/qa-files.mjs"
import {
  beginQaProof,
  recordDbProof,
  recordHttpProof,
  recordReleaseProof,
} from "./task8/qa-proof.mjs"

async function main() {
  const [operation, metadataPath, ...rest] = process.argv.slice(2)
  if (operation === "wait") {
    await waitForMetadata(metadataPath, Number(rest[0]))
    await beginQaProof(metadataPath, true)
  } else if (operation === "get") {
    process.stdout.write(String(await readMetadataValue(metadataPath, rest[0])))
  } else if (operation === "release") {
    await release(metadataPath)
    await recordReleaseProof()
  } else if (operation === "assert-configured") {
    const body = JSON.parse(await readFile(metadataPath, "utf8"))
    assertConfiguredBody(body)
    await recordHttpProof("configured", 200, body)
  } else if (operation === "assert-unauthorized") {
    const body = JSON.parse(await readFile(metadataPath, "utf8"))
    assertUnauthorizedBody(body)
    await recordHttpProof("unauthorized", 401, body)
  } else if (operation === "assert-cancellation") {
    const body = JSON.parse(await readFile(metadataPath, "utf8"))
    assertCancellationBody(body, rest[0], rest[1], Number(rest[2]), rest[3])
    await recordHttpProof("cancellation", 200, body, "curl -b")
  } else if (operation === "assert-state") {
    await assertState(metadataPath, rest)
  } else {
    throw new Error(
      "usage: qa-control wait|get|release|assert-configured|assert-unauthorized|assert-cancellation|assert-state",
    )
  }
}

async function assertState(metadataPath, args) {
  const metadata = await assertMetadata(metadataPath, process.cwd())
  const [mode, bodyPath, reason] = args
  if (metadata.reservationId !== fixedIds.cancellableReservation) {
    throw new Error("QA metadata reservationId is not the exact Todo8 reservation")
  }
  const body = bodyPath ? JSON.parse(await readFile(bodyPath, "utf8")) : null
  const proof = await assertQaState(mode, body, reason)
  await recordDbProof(mode, proof)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
