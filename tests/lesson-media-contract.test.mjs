import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const lessonAssetNames = ["lesson-tennis", "lesson-pilates", "lesson-running"]

test("normal lesson media assets are nonblank WebP rasters rather than legacy SVG fallbacks", async () => {
  // Given: the public lesson-image assets served to normal lesson cards.
  const assets = await Promise.all(
    lessonAssetNames.map(async (name) => {
      const [raster, fallback] = await Promise.all([
        readFile(new URL(`../public/images/${name}.webp`, import.meta.url)),
        readFile(new URL(`../public/images/${name}.svg`, import.meta.url)),
      ])
      return { fallback, name, raster }
    }),
  )

  // When: their binary headers and VP8 frame dimensions are inspected.
  // Then: every normal asset is a substantial, nonblank WebP raster and differs from its SVG fallback.
  for (const { fallback, name, raster } of assets) {
    assert.equal(raster.subarray(0, 4).toString("ascii"), "RIFF", `${name} RIFF magic`)
    assert.equal(raster.subarray(8, 12).toString("ascii"), "WEBP", `${name} WebP magic`)
    assert.equal(raster.subarray(12, 16).toString("ascii"), "VP8 ", `${name} VP8 payload`)
    assert.ok(raster.byteLength >= 32_000, `${name} has nontrivial raster data`)
    assert.ok(raster.readUInt16LE(26) >= 1_200, `${name} has a nonblank width`)
    assert.ok(raster.readUInt16LE(28) >= 900, `${name} has a nonblank height`)
    assert.match(fallback.toString("utf8", 0, 32), /^<svg\s/iu, `${name} legacy fallback shape`)
    assert.notDeepEqual(raster, fallback, `${name} normal asset is not the SVG fallback`)
  }
})
