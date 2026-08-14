import { mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { fixedIds, fixtureUsers } from "../fixtures.mjs"
import { createLearnerCookieJar } from "../ssr-cookie-jar.mjs"
import { assertMetadata } from "./qa-assertions.mjs"

export async function createQaFiles({ baseUrl, metadataPath, provision, status }) {
  const qaDir = await mkdirExternalQaDir(metadataPath)
  const releasePath = path.join(qaDir, "release.json")
  const cookieJarPath = path.join(qaDir, "learner-cookies.txt")
  const jar = await createLearnerCookieJar({
    email: fixtureUsers.find((user) => user.key === "learner").email,
    password: provision.runPassword,
    status,
  })
  await writeFile(cookieJarPath, toNetscapeCookies(jar, new URL(baseUrl).hostname), {
    mode: 0o600,
  })
  await writeFile(releasePath, '{"released":false}\n', { mode: 0o600 })
  const metadata = {
    baseUrl,
    cookieJarPath,
    releasePath,
    reservationId: fixedIds.cancellableReservation,
  }
  await writeFile(metadataPath, JSON.stringify(metadata), { mode: 0o600 })
  await assertMetadata(metadataPath, process.cwd())
  return metadata
}

export async function isReleased(releasePath) {
  try {
    const release = JSON.parse(await readFile(releasePath, "utf8"))
    return release.released === true
  } catch {
    return false
  }
}

export async function release(metadataPath) {
  const metadata = await assertMetadata(metadataPath, process.cwd())
  await writeFile(metadata.releasePath, '{"released":true}\n', { mode: 0o600 })
  return metadata
}

export async function waitForMetadata(metadataPath, timeoutSeconds) {
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 0 || timeoutSeconds > 900) {
    throw new Error("wait timeout must be between 0 and 900 seconds")
  }
  const deadline = Date.now() + timeoutSeconds * 1000
  let lastError
  while (Date.now() <= deadline) {
    try {
      return await assertMetadata(metadataPath, process.cwd())
    } catch (error) {
      lastError = error
      await delay(250)
    }
  }
  throw lastError ?? new Error("QA metadata wait timed out")
}

export async function readMetadataValue(metadataPath, key) {
  const metadata = await assertMetadata(metadataPath, process.cwd())
  if (!Object.hasOwn(metadata, key)) throw new Error(`Unknown metadata key: ${key}`)
  return metadata[key]
}

function toNetscapeCookies(jar, domain) {
  const rows = jar
    .getAll()
    .filter((cookie) => cookie.name.includes("-auth-token"))
    .map((cookie) => [domain, "FALSE", "/", "FALSE", "0", cookie.name, cookie.value].join("\t"))
  if (rows.length === 0) throw new Error("Learner auth cookie jar has no Supabase auth cookies")
  return `# Netscape HTTP Cookie File\n${rows.join("\n")}\n`
}

async function mkdirExternalQaDir(metadataPath) {
  const parent = path.dirname(metadataPath)
  if (path.relative(process.cwd(), parent) === "") {
    throw new Error("QA metadata directory must be outside repository")
  }
  await mkdir(parent, { mode: 0o700, recursive: true })
  return parent || os.tmpdir()
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
