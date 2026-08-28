#!/usr/bin/env node
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { ensureAuthGatewayReady } from "../auth-rls/runtime.mjs"
import { createLearnerCookieJar } from "../ssr-cookie-jar.mjs"
import { createLessonImageDatabase } from "./database.mjs"
import { requestJson, uploadSigned } from "./http-client.mjs"
import { createTinyJpeg, createTinyPng, createTinyWebp } from "./image-fixtures.mjs"
import {
  createLessonImagePersonaClients,
  provisionLessonImageFixtures,
  signInLessonImagePersonas,
  signOutLessonImagePersonas,
} from "./provision.mjs"
import { startIsolatedLessonImageNext } from "./runtime.mjs"

const formats = [
  ["image/jpeg", createTinyJpeg],
  ["image/png", createTinyPng],
  ["image/webp", createTinyWebp],
]

export async function runLessonImageRpcBoundarySecurityScenario() {
  let clients = null
  let database = null
  let next = null
  let provision = null
  let cleanup = null
  const observations = []
  try {
    await ensureAuthGatewayReady()
    const runId = process.env.SPOLINK_TASK9_RUN_ID ?? "rpc-boundary"
    provision = await provisionLessonImageFixtures({ runId })
    database = createLessonImageDatabase(provision.status)
    next = await startIsolatedLessonImageNext({
      portBase: provision.namespace.portBase,
      repoRoot: process.cwd(),
      runId,
      status: provision.status,
    })
    clients = createLessonImagePersonaClients(provision.status, provision.users)
    await signInLessonImagePersonas(clients, provision.users, provision.runPassword)
    const coach = provision.users.find((user) => user.key === "coach")
    assert.ok(coach)
    const jar = await createLearnerCookieJar({
      email: coach.email,
      password: provision.runPassword,
      status: provision.status,
    })

    const spoofLesson = await database.createLesson(provision)
    const spoofBytes = Buffer.alloc(createTinyPng().length, 0x41)
    const spoofIntent = await issueIntent(
      next.baseUrl,
      jar,
      spoofLesson,
      "image/png",
      spoofBytes.length,
    )
    database.trackObject(spoofIntent.objectName)
    const spoofUpload = await uploadSigned(clients.coach, spoofIntent, spoofBytes, "image/png")
    assert.equal(spoofUpload.error, null)

    const directAttempts = await exerciseDirectRpcAttempts({ clients, provision, spoofIntent })
    assert.equal((await database.readImages(spoofLesson)).length, 0)
    assert.equal(await database.objectRowExists(spoofIntent.objectName), true)

    const spoofRegistration = await registerIntent(next.baseUrl, jar, spoofLesson, spoofIntent)
    assert.equal(spoofRegistration.status, 422)
    assert.equal((await database.readImages(spoofLesson)).length, 0)
    assert.equal(await database.objectRowExists(spoofIntent.objectName), false)
    assert.equal((await database.readIntents(spoofLesson)).at(-1)?.status, "cancelled")
    observations.push({
      directAttempts,
      label: "spoof_metadata_magic_byte_boundary",
      objectRemoved: true,
      readyRows: 0,
      status: spoofRegistration.status,
    })

    for (const [mimeType, createBytes] of formats) {
      const lessonId = await database.createLesson(provision)
      const bytes = createBytes()
      const intent = await issueIntent(next.baseUrl, jar, lessonId, mimeType, bytes.length)
      database.trackObject(intent.objectName)
      const upload = await uploadSigned(clients.coach, intent, bytes, mimeType)
      assert.equal(upload.error, null)
      const first = await registerIntent(next.baseUrl, jar, lessonId, intent)
      assert.equal(first.status, 201)
      const duplicate = await registerIntent(next.baseUrl, jar, lessonId, intent)
      assert.equal(duplicate.status, 201)
      assert.equal((await database.readImages(lessonId)).length, 1)
      assert.equal(await database.objectRowExists(intent.objectName), true)
      observations.push({
        duplicateStatus: duplicate.status,
        label: `valid_${mimeType}`,
        objectRetained: true,
        readyRows: 1,
        status: first.status,
      })
    }
  } finally {
    if (clients) await signOutLessonImagePersonas(clients)
    if (database && provision) await database.cleanup(provision)
    if (provision) await provision.cleanup()
    const databaseCleanup =
      database && provision ? await database.assertNamespaceZero(provision) : null
    const fixtureCleanup = provision ? await provision.assertZero() : null
    cleanup = databaseCleanup && fixtureCleanup ? { ...databaseCleanup, ...fixtureCleanup } : null
    if (database) await database.close()
    if (provision) await provision.close()
    if (next) await next.stop()
    await writeEvidence({ cleanup, observations })
  }
  return { cleanup, observations }
}

async function exerciseDirectRpcAttempts({ clients, provision, spoofIntent }) {
  const oldOwner = await clients.coach.rpc("register_lesson_image", {
    checked_intent_id: spoofIntent.intentId,
    checked_object_name: spoofIntent.objectName,
  })
  const actorIds = [provision.authIds.coach, provision.authIds.otherLearner, randomUUID()]
  const browserNew = []
  for (const actorId of actorIds) {
    const attempt = await clients.coach.rpc("register_validated_lesson_image", {
      checked_actor_id: actorId,
      checked_intent_id: spoofIntent.intentId,
      checked_object_name: spoofIntent.objectName,
    })
    assert.ok(attempt.error)
    browserNew.push(attempt.error.code)
  }
  const trustedWrongActors = []
  for (const actorId of actorIds.slice(1)) {
    const attempt = await provision.clients.serviceClient.rpc("register_validated_lesson_image", {
      checked_actor_id: actorId,
      checked_intent_id: spoofIntent.intentId,
      checked_object_name: spoofIntent.objectName,
    })
    assert.ok(attempt.error)
    trustedWrongActors.push(attempt.error.code)
  }
  assert.ok(oldOwner.error)
  return { browserNew, oldOwner: oldOwner.error.code, trustedWrongActors }
}

async function issueIntent(baseUrl, jar, lessonId, mimeType, sizeBytes) {
  const result = await requestJson(baseUrl, `/api/lessons/${lessonId}/images/upload-intents`, {
    body: { mimeType, sizeBytes },
    jar,
  })
  assert.equal(result.status, 201)
  return result.body.data
}

async function registerIntent(baseUrl, jar, lessonId, intent) {
  return requestJson(baseUrl, `/api/lessons/${lessonId}/images`, {
    body: { intentId: intent.intentId, objectName: intent.objectName },
    jar,
  })
}

async function writeEvidence(value) {
  const evidenceDir = process.env.SPOLINK_RPC_BOUNDARY_EVIDENCE_DIR
  if (!evidenceDir) return
  await mkdir(evidenceDir, { recursive: true })
  await writeFile(
    path.join(evidenceDir, "live-security-scenario.json"),
    `${JSON.stringify(value, null, 2)}\n`,
    { mode: 0o600 },
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { runLessonImageRpcBoundarySecurityCli } = await import(
    "./registration-security/rpc-boundary-security.mjs"
  )
  await runLessonImageRpcBoundarySecurityCli(runLessonImageRpcBoundarySecurityScenario)
}
