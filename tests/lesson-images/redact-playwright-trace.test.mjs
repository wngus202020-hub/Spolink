import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { promisify } from "node:util"

import { independentlyScanPlaywrightTrace } from "./playwright-trace-security-scan.mjs"
import { redactPlaywrightTrace } from "./redact-playwright-trace.mjs"

const execFileAsync = promisify(execFile)

test("redacts secrets from arbitrary nested textual resources while preserving binary entries", async () => {
  const fixture = await createAdversarialTrace()
  try {
    const before = await independentlyScanPlaywrightTrace(
      fixture.tracePath,
      fixture.forbiddenValues,
    )
    assert.ok(before.forbiddenPatternMatches > 0)
    const result = await redactPlaywrightTrace(fixture.tracePath)
    const after = await independentlyScanPlaywrightTrace(fixture.tracePath, fixture.forbiddenValues)

    const resource = await readArchiveEntry(fixture.tracePath, fixture.resourceEntry)
    const sourceSnapshot = await readArchiveEntry(fixture.tracePath, fixture.sourceEntry)
    const utf16Source = decodeUtf16Le(
      await readArchiveEntryBuffer(fixture.tracePath, fixture.utf16SourceEntry),
    )
    const utf16BeSource = decodeUtf16Be(
      await readArchiveEntryBuffer(fixture.tracePath, fixture.utf16BeSourceEntry),
    )
    const structured = JSON.parse(resource)
    for (const secret of fixture.forbiddenValues) {
      assert.equal(resource.includes(secret), false)
    }
    assert.deepEqual(
      await readArchiveEntryBuffer(fixture.tracePath, fixture.binaryEntry),
      fixture.binaryBytes,
    )
    assert.equal(structured.access_token, "<redacted>")
    assert.equal(structured.data.token, "<redacted>")
    assert.equal(structured.data.uploadUrl, "<redacted-signed-upload-url>")
    assert.equal(structured.request.headers[0].value, "<redacted>")
    assert.equal(structured.request.headers[1].value, "<redacted>")
    assert.deepEqual(JSON.parse(structured.request.postData), {
      email: "<redacted-email>",
      password: "<redacted-password>",
      refresh_token: "<redacted>",
    })
    assert.match(sourceSnapshot, /const fixturePassword = "<redacted-password>"/u)
    assert.match(sourceSnapshot, /const copiedRuntimeValue = "<redacted>"/u)
    assert.match(sourceSnapshot, /const sourceToken = "<redacted>"/u)
    assert.match(utf16Source, /const utf16Password = "<redacted-password>"/u)
    assert.match(utf16BeSource, /const utf16BeSecret = "<redacted>"/u)
    assert.equal(result.entriesScanned, 6)
    assert.equal(result.textualEntriesProcessed, 5)
    assert.equal(result.binaryEntriesPreserved, 1)
    assert.ok(result.changedTextEntries > 0)
    assert.ok(result.preSanitizationForbiddenPatternMatches > 0)
    assert.equal(result.forbiddenPatternMatches, 0)
    assert.equal(after.forbiddenPatternMatches, 0)
  } finally {
    await rm(fixture.root, { force: true, recursive: true })
  }
})

test("redacts a multi-megabyte minified source snapshot within a bounded timeout", {
  timeout: 5_000,
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "spolink-trace-linear-time-test-"))
  try {
    const content = path.join(root, "content")
    const entry = "resources/src@large-minified.txt"
    const password = ["LocalOnly", "large", randomUUID()].join("-")
    await mkdir(path.dirname(path.join(content, entry)), { recursive: true })
    const harmless = "const ordinaryValue='abcdefghijklmnopqrstuvwxyz0123456789';"
    await writeFile(
      path.join(content, entry),
      `${harmless.repeat(72_000)}const fixturePassword=${JSON.stringify(password)};`,
    )
    const tracePath = path.join(root, "large-trace.zip")
    await execFileAsync("zip", ["-q", "-r", tracePath, "."], { cwd: content })

    const startedAt = performance.now()
    const result = await redactPlaywrightTrace(tracePath, [password])
    const elapsedMilliseconds = performance.now() - startedAt
    const redacted = await readArchiveEntry(tracePath, entry)

    assert.ok(elapsedMilliseconds < 4_500)
    assert.equal(redacted.includes(password), false)
    assert.match(redacted, /fixturePassword="<redacted-password>"/u)
    assert.equal(result.forbiddenPatternMatches, 0)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

async function createAdversarialTrace() {
  const root = await mkdtemp(path.join(tmpdir(), "spolink-trace-redaction-test-"))
  const content = path.join(root, "content")
  const resourceEntry = "resources/deep/arbitrary-resource-name"
  const sourceEntry = "resources/src@49b0a24ecb.txt"
  const utf16SourceEntry = "resources/source-without-extension"
  const utf16BeSourceEntry = "resources/src@utf16be.txt"
  const binaryEntry = "resources/binary-payload.dat"
  await mkdir(path.join(content, "resources/deep"), { recursive: true })
  const accessToken = ["access", "credential", randomUUID()].join("-")
  const refreshToken = ["refresh", "credential", randomUUID()].join("-")
  const signedToken = ["signed", "upload", randomUUID()].join("-")
  const password = ["fixture", "password", randomUUID()].join("-")
  const email = ["fixture", "trace.invalid"].join("@")
  const userId = randomUUID()
  const jwt = ["eyJ0eXAiOiJKV1QifQ", "eyJzdWIiOiJmaXh0dXJlIn0", "signature"].join(".")
  const uploadUrl = `http://127.0.0.1/storage/v1/object/upload/sign/lesson-images/${userId}?token=${signedToken}`
  const nestedBody = JSON.stringify({ email, password, refresh_token: refreshToken })
  await writeFile(
    path.join(content, resourceEntry),
    JSON.stringify({
      access_token: accessToken,
      data: { token: signedToken, uploadUrl },
      request: {
        headers: [
          { name: "authorization", value: `Bearer ${jwt}` },
          { name: "cookie", value: `session=${refreshToken}` },
        ],
        postData: nestedBody,
        url: `https://trace.invalid/callback?access_token=${accessToken}&user_id=${userId}`,
      },
      user: { email, id: userId },
    }),
  )
  await writeFile(
    path.join(content, "trace.trace"),
    `${JSON.stringify({ type: "context-options" })}\n`,
  )
  await writeFile(
    path.join(content, sourceEntry),
    [
      `const fixturePassword = ${JSON.stringify(password)}`,
      `const copiedRuntimeValue = ${JSON.stringify(password)}`,
      `const sourceToken = ${JSON.stringify(accessToken)}`,
    ].join("\n"),
  )
  await writeFile(
    path.join(content, utf16SourceEntry),
    Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(`const utf16Password = ${JSON.stringify(password)}`, "utf16le"),
    ]),
  )
  await writeFile(
    path.join(content, utf16BeSourceEntry),
    encodeUtf16Be(`const utf16BeSecret = ${JSON.stringify(refreshToken)}`),
  )
  const binaryBytes = Buffer.from([0, 255, 1, 254, 2, 253, 3, 252])
  await writeFile(path.join(content, binaryEntry), binaryBytes)
  const tracePath = path.join(root, "trace.zip")
  await execFileAsync("zip", ["-q", "-r", tracePath, "."], { cwd: content })
  return {
    binaryBytes,
    binaryEntry,
    forbiddenValues: [
      accessToken,
      refreshToken,
      signedToken,
      password,
      email,
      userId,
      jwt,
      uploadUrl,
    ],
    resourceEntry,
    root,
    sourceEntry,
    tracePath,
    utf16BeSourceEntry,
    utf16SourceEntry,
  }
}

function decodeUtf16Le(bytes) {
  const offset = bytes[0] === 0xff && bytes[1] === 0xfe ? 2 : 0
  return bytes.subarray(offset).toString("utf16le")
}

function decodeUtf16Be(bytes) {
  const offset = bytes[0] === 0xfe && bytes[1] === 0xff ? 2 : 0
  const swapped = Buffer.from(bytes.subarray(offset))
  for (let index = 0; index < swapped.length; index += 2) {
    ;[swapped[index], swapped[index + 1]] = [swapped[index + 1], swapped[index]]
  }
  return swapped.toString("utf16le")
}

function encodeUtf16Be(value) {
  const bytes = Buffer.from(value, "utf16le")
  for (let index = 0; index < bytes.length; index += 2) {
    ;[bytes[index], bytes[index + 1]] = [bytes[index + 1], bytes[index]]
  }
  return Buffer.concat([Buffer.from([0xfe, 0xff]), bytes])
}

async function readArchiveEntry(tracePath, entry) {
  return (await readArchiveEntryBuffer(tracePath, entry)).toString("utf8")
}

async function readArchiveEntryBuffer(tracePath, entry) {
  const { stdout } = await execFileAsync("unzip", ["-p", tracePath, entry], {
    encoding: "buffer",
    maxBuffer: 20 * 1024 * 1024,
  })
  return stdout
}
