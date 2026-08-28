import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readdir } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"

import {
  createExactPng,
  createTinyJpeg,
  createTinyPng,
  createTinyWebp,
  FIVE_MIB,
} from "./image-fixtures.mjs"

test("runtime image fixtures are valid JPEG, PNG, and WebP bitmaps", async () => {
  const sharp = await loadSharp()
  for (const [format, pattern, bytes] of [
    ["jpeg", /JPEG image data/i, createTinyJpeg()],
    ["png", /PNG image data, 1 x 1/i, createTinyPng()],
    ["webp", /Web\/P image/i, createTinyWebp()],
  ]) {
    assert.match(identify(bytes), pattern)
    const decoded = await sharp(bytes, { failOn: "error" }).raw().toBuffer({
      resolveWithObject: true,
    })
    assert.equal(decoded.info.width, 1)
    assert.equal(decoded.info.height, 1)
    assert.equal(decoded.data.length, decoded.info.channels)
    if (format === "webp") {
      assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF")
      assert.equal(bytes.readUInt32LE(4) + 8, bytes.length)
      assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP")
      assert.equal(decoded.data.toString("hex"), "112233")
    }
  }
})

test("exact boundary PNG fixtures remain valid at 5 MiB and 5 MiB plus one", async () => {
  for (const size of [FIVE_MIB, FIVE_MIB + 1]) {
    const bytes = createExactPng(size)
    assert.equal(bytes.length, size)
    assert.match(identify(bytes), /PNG image data, 1 x 1/i)
  }
})

function identify(bytes) {
  const result = spawnSync("file", ["-b", "-"], {
    encoding: "utf8",
    input: bytes,
    maxBuffer: 1024 * 1024,
    timeout: 5_000,
  })
  assert.equal(result.status, 0)
  return result.stdout
}

async function loadSharp() {
  const pnpmRoot = path.resolve("node_modules/.pnpm")
  const packages = await readdir(pnpmRoot)
  const directory = packages
    .filter((name) => /^sharp@[0-9]/u.test(name))
    .sort()
    .at(-1)
  assert.ok(directory, "Sharp must be installed for strict fixture decoding")
  const modulePath = path.join(pnpmRoot, directory, "node_modules/sharp/dist/index.mjs")
  const loaded = await import(pathToFileURL(modulePath).href)
  return loaded.default
}

test("exact PNG generator rejects malformed target sizes", () => {
  for (const value of [0, 80, 81.5, Number.NaN]) {
    assert.throws(() => createExactPng(value), TypeError)
  }
})
