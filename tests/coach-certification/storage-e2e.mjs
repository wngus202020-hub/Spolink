#!/usr/bin/env node
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import process from "node:process"

import {
  COACH_CERTIFICATE_BUCKET,
  COACH_CERTIFICATE_MAX_BYTES,
  registerCertificateMetadataWithCompensation,
} from "../../lib/storage/coach-certification.ts"
import { runReset, runStart, runStop } from "../../scripts/supabase-local.mjs"
import {
  createPersonaClients,
  signInPersonas,
  signOutPersonas,
} from "../supabase-e2e/auth-rls/clients.mjs"
import { provisionWithAuthReadiness } from "../supabase-e2e/auth-rls/runtime.mjs"
import { readGuardedLocalStatus } from "../supabase-e2e/local-status.mjs"

const allCases = [
  "owner-admin-read",
  "foreign-owner",
  "wrong-signature",
  "oversize",
  "overwrite",
  "submitted-delete",
  "direct-object-mutation",
]
const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

async function main() {
  const selected = parseCases(process.argv)
  let provision = null
  let clients = null
  let started = false
  let scenarioError = null
  let cleanupError = null
  const createdObjects = new Set()
  try {
    if (!(await hasGuardedRuntime())) {
      started = true
      await runStart()
    }
    await runReset()
    provision = await provisionWithAuthReadiness()
    const ownerCoachProfileId = randomUUID()
    const { error: ownerProfileError } = await provision.clients.serviceClient
      .from("coach_profiles")
      .insert({
        id: ownerCoachProfileId,
        user_id: provision.authIds.learner,
        status: "draft",
        service_region: "Storage E2E",
      })
    assert.ifError(ownerProfileError)
    clients = createPersonaClients(provision.status)
    await signInPersonas(clients, provision.runPassword)

    const context = { clients, createdObjects, ownerCoachProfileId, provision }
    for (const caseName of selected) await runCase(caseName, context)

    console.log(
      JSON.stringify({
        bucket: { private: true, sizeLimitBytes: COACH_CERTIFICATE_MAX_BYTES },
        cases: selected.map((name) => ({ name, passed: true })),
        signedReadExpiresIn: 300,
      }),
    )
  } catch (error) {
    scenarioError = error
  }
  try {
    if (provision) {
      for (const objectName of createdObjects) {
        await provision.clients.serviceClient.storage
          .from(COACH_CERTIFICATE_BUCKET)
          .remove([objectName])
      }
      await provision.clients.serviceClient
        .from("coach_certificates")
        .delete()
        .like("certificate_name", "Storage E2E%")
      await provision.clients.serviceClient
        .from("coach_profiles")
        .delete()
        .eq("service_region", "Storage E2E")
    }
    if (clients) await signOutPersonas(clients)
    if (provision) await provision.cleanup()
  } catch (error) {
    cleanupError = error
  }
  if (started) {
    try {
      await runStop()
    } catch (error) {
      cleanupError ??= error
    }
  }
  if (scenarioError) throw scenarioError
  if (cleanupError) throw cleanupError
}

async function hasGuardedRuntime() {
  try {
    await readGuardedLocalStatus()
    return true
  } catch (error) {
    if (error instanceof Error) return false
    throw error
  }
}

async function runCase(caseName, context) {
  switch (caseName) {
    case "owner-admin-read":
      return ownerAdminRead(context)
    case "foreign-owner":
      return foreignOwner(context)
    case "wrong-signature":
      return wrongSignature(context)
    case "oversize":
      return oversize(context)
    case "overwrite":
      return overwrite(context)
    case "submitted-delete":
      return submittedDelete(context)
    case "direct-object-mutation":
      return directObjectMutation(context)
    default:
      throw new Error(`Unknown Storage E2E case: ${caseName}`)
  }
}

async function ownerAdminRead({ clients, createdObjects, provision }) {
  const objectName = await uploadOwnerPng(
    clients.learner,
    provision.authIds.learner,
    createdObjects,
  )
  const { data: ownerData, error: ownerError } = await clients.learner.storage
    .from(COACH_CERTIFICATE_BUCKET)
    .download(objectName)
  assert.ifError(ownerError)
  assert.deepEqual(new Uint8Array(await ownerData.arrayBuffer()), pngBytes)

  const { data: bucket, error: bucketError } =
    await provision.clients.serviceClient.storage.getBucket(COACH_CERTIFICATE_BUCKET)
  assert.ifError(bucketError)
  assert.equal(bucket.public, false)
  assert.equal(bucket.file_size_limit, COACH_CERTIFICATE_MAX_BYTES)

  const { data: directAdmin, error: directAdminError } = await clients.admin.storage
    .from(COACH_CERTIFICATE_BUCKET)
    .download(objectName)
  assert.equal(directAdmin, null)
  assert.ok(directAdminError)

  const { data: signed, error: signedError } = await provision.clients.serviceClient.storage
    .from(COACH_CERTIFICATE_BUCKET)
    .createSignedUrl(objectName, 300)
  assert.ifError(signedError)
  const response = await fetch(signed.signedUrl)
  assert.equal(response.status, 200)
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), pngBytes)
}

async function foreignOwner({ clients, createdObjects, provision }) {
  const objectName = await uploadOwnerPng(
    clients.learner,
    provision.authIds.learner,
    createdObjects,
  )
  for (const persona of ["anonymous", "otherLearner", "coach", "pendingCoach"]) {
    const { data, error } = await clients[persona].storage
      .from(COACH_CERTIFICATE_BUCKET)
      .download(objectName)
    assert.equal(data, null, `${persona} must not read the owner object`)
    assert.ok(error, `${persona} read must be denied`)
  }
  for (const persona of ["otherLearner", "coach", "pendingCoach"]) {
    const { data, error } = await clients[persona].storage
      .from(COACH_CERTIFICATE_BUCKET)
      .createSignedUploadUrl(objectName, { upsert: false })
    assert.equal(data, null, `${persona} must not sign an owner upload`)
    assert.ok(error, `${persona} upload signing must be denied`)
  }
}

async function wrongSignature({ clients, createdObjects, provision }) {
  const objectName = `${provision.authIds.learner}/${randomUUID()}.png`
  createdObjects.add(objectName)
  await uploadSigned(
    clients.learner,
    objectName,
    new Blob([Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d])], { type: "image/png" }),
  )
  await assert.rejects(
    registerCertificateMetadataWithCompensation(
      { objectName, userId: provision.authIds.learner },
      {
        readObject: async (bucket, name) => {
          const { data, error } = await provision.clients.serviceClient.storage
            .from(bucket)
            .download(name)
          assert.ifError(error)
          return data
        },
        registerMetadata: async () => assert.fail("spoofed bytes must not register"),
        removeObject: async (bucket, name) => {
          const { error } = await provision.clients.serviceClient.storage
            .from(bucket)
            .remove([name])
          assert.ifError(error)
        },
      },
    ),
    (error) => error?.code === "invalid_file",
  )
  assert.equal(await objectExists(provision.clients.serviceClient, objectName), false)
  createdObjects.delete(objectName)
}

async function oversize({ clients, provision }) {
  const objectName = `${provision.authIds.learner}/${randomUUID()}.png`
  const oversized = new Blob([new Uint8Array(COACH_CERTIFICATE_MAX_BYTES + 1)], {
    type: "image/png",
  })
  const { data: signed, error: signError } = await clients.learner.storage
    .from(COACH_CERTIFICATE_BUCKET)
    .createSignedUploadUrl(objectName, { upsert: false })
  assert.ifError(signError)
  const { error } = await clients.learner.storage
    .from(COACH_CERTIFICATE_BUCKET)
    .uploadToSignedUrl(objectName, signed.token, oversized, { contentType: "image/png" })
  assert.ok(error)
  assert.equal(await objectExists(provision.clients.serviceClient, objectName), false)
}

async function overwrite({ clients, createdObjects, provision }) {
  const objectName = await uploadOwnerPng(
    clients.learner,
    provision.authIds.learner,
    createdObjects,
  )
  for (const upsert of [false, true]) {
    const { error } = await clients.learner.storage
      .from(COACH_CERTIFICATE_BUCKET)
      .upload(objectName, new Blob([pngBytes], { type: "image/png" }), {
        contentType: "image/png",
        upsert,
      })
    assert.ok(error, `overwrite with upsert=${upsert} must fail`)
  }
  assert.equal(await objectExists(provision.clients.serviceClient, objectName), true)
}

async function submittedDelete({ clients, createdObjects, ownerCoachProfileId, provision }) {
  const objectName = await uploadOwnerPng(
    clients.learner,
    provision.authIds.learner,
    createdObjects,
  )
  const { error: certificateError } = await provision.clients.serviceClient
    .from("coach_certificates")
    .insert({
      certificate_name: `Storage E2E ${randomUUID()}`,
      coach_profile_id: ownerCoachProfileId,
      file_path: objectName,
    })
  assert.ifError(certificateError)
  const { data: certificateRows, error: readCertificateError } =
    await provision.clients.serviceClient
      .from("coach_certificates")
      .select("id,certificate_name")
      .eq("file_path", objectName)
  assert.ifError(readCertificateError)
  assert.equal(certificateRows.length, 1)
  const certificateId = certificateRows[0]?.id
  assert.ok(certificateId)
  const { error: submittedError } = await provision.clients.serviceClient
    .from("coach_profiles")
    .update({ status: "submitted" })
    .eq("id", ownerCoachProfileId)
  assert.ifError(submittedError)

  await clients.learner.storage.from(COACH_CERTIFICATE_BUCKET).remove([objectName])
  assert.equal(await objectExists(provision.clients.serviceClient, objectName), true)

  const { data: updatedRows, error: updateError } = await clients.learner
    .from("coach_certificates")
    .update({ certificate_name: "Storage E2E forbidden update" })
    .eq("id", certificateId)
    .select("id")
  assert.ifError(updateError)
  assert.deepEqual(updatedRows, [])
  const { data: unchanged, error: unchangedError } = await provision.clients.serviceClient
    .from("coach_certificates")
    .select("certificate_name")
    .eq("id", certificateId)
    .single()
  assert.ifError(unchangedError)
  assert.notEqual(unchanged.certificate_name, "Storage E2E forbidden update")
}

async function directObjectMutation({ clients, provision }) {
  const objectName = `${provision.authIds.learner}/${randomUUID()}.png`
  const { data, error } = await clients.learner
    .schema("storage")
    .from("objects")
    .insert({ bucket_id: COACH_CERTIFICATE_BUCKET, name: objectName })
  assert.equal(data, null)
  assert.ok(error)
  assert.equal(await objectExists(provision.clients.serviceClient, objectName), false)

  const { error: bucketError } = await clients.learner.storage.updateBucket(
    COACH_CERTIFICATE_BUCKET,
    { public: true },
  )
  assert.ok(bucketError)
  const { data: bucket, error: readBucketError } =
    await provision.clients.serviceClient.storage.getBucket(COACH_CERTIFICATE_BUCKET)
  assert.ifError(readBucketError)
  assert.equal(bucket.public, false)
}

async function uploadOwnerPng(client, userId, createdObjects) {
  const objectName = `${userId}/${randomUUID()}.png`
  await uploadSigned(client, objectName, new Blob([pngBytes], { type: "image/png" }))
  createdObjects.add(objectName)
  return objectName
}

async function uploadSigned(client, objectName, blob) {
  const bucket = client.storage.from(COACH_CERTIFICATE_BUCKET)
  const { data: signed, error: signError } = await bucket.createSignedUploadUrl(objectName, {
    upsert: false,
  })
  assert.ifError(signError)
  const { error: uploadError } = await bucket.uploadToSignedUrl(objectName, signed.token, blob, {
    contentType: blob.type,
  })
  assert.ifError(uploadError)
}

async function objectExists(serviceClient, objectName) {
  const { data, error } = await serviceClient.storage
    .from(COACH_CERTIFICATE_BUCKET)
    .download(objectName)
  if (error) return false
  return data.size > 0
}

function parseCases(argv) {
  const caseIndex = argv.indexOf("--case")
  if (caseIndex === -1) return allCases
  const requested = argv[caseIndex + 1]?.split(",").filter(Boolean) ?? []
  assert.ok(requested.length > 0, "--case requires a comma-separated case list")
  for (const caseName of requested)
    assert.ok(allCases.includes(caseName), `Unknown case: ${caseName}`)
  return requested
}

await main()
