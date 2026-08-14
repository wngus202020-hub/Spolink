import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { lessonRegionSource, lessonRegions } from "../lib/lesson-regions.ts"
import {
  buildLessonRegionCatalog,
  parseRegionSnapshot,
  REGION_FIXTURE_SHA256,
  REGION_HEADERS,
  renderLessonRegions,
} from "../scripts/generate-lesson-regions.mjs"

const fixtureUrl = new URL("./fixtures/regions/molit-legal-districts-20260630.csv", import.meta.url)
const generatedUrl = new URL("../lib/lesson-regions.ts", import.meta.url)
const encoder = new TextEncoder()
const headers = REGION_HEADERS.join(",")

function bytesFor(lines) {
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${lines.join("\r\n")}\r\n`)])
}

function parseInMemory(lines) {
  const bytes = bytesFor([headers, ...lines])
  const digest = createHash("sha256").update(bytes).digest("hex")
  return parseRegionSnapshot(bytes, digest)
}

test("Given the immutable fixture, When its bytes are inspected, Then its hash, BOM, and headers are exact", async () => {
  const bytes = await readFile(fixtureUrl)
  const digest = createHash("sha256").update(bytes).digest("hex")

  assert.equal(digest, REGION_FIXTURE_SHA256)
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf])
  assert.equal(bytes.toString("utf8").split(/\r?\n/u, 1)[0]?.slice(1), headers)
})

test("Given the official fixture, When the catalog is generated, Then all canonical provinces and official children are unique", async () => {
  const catalog = buildLessonRegionCatalog(parseRegionSnapshot(await readFile(fixtureUrl)))
  const labels = catalog.map((province) => province.label)

  assert.equal(catalog.length, 17)
  assert.equal(new Set(labels).size, 17)
  assert.equal(catalog.flatMap((province) => province.districts).length, 268)
  for (const province of catalog) {
    assert.equal(
      new Set(province.districts.map((district) => district.label)).size,
      province.districts.length,
    )
  }
})

test("Given the generated catalog, When representative boundaries are read, Then canonical labels and ordering are preserved", () => {
  const seoul = lessonRegions.find((province) => province.label === "서울특별시")
  const gyeonggi = lessonRegions.find((province) => province.label === "경기도")
  const jeju = lessonRegions.find((province) => province.label === "제주특별자치도")
  const sejong = lessonRegions.find((province) => province.label === "세종특별자치시")

  assert.equal(seoul?.districts[0]?.queryValue, "서울특별시 종로구")
  assert.equal(
    seoul?.districts.find((district) => district.label === "강남구")?.queryValue,
    "서울특별시 강남구",
  )
  assert.equal(
    gyeonggi?.districts.find((district) => district.label === "수원시")?.queryValue,
    "경기도 수원시",
  )
  assert.equal(jeju?.districts.at(-1)?.queryValue, "제주특별자치도 서귀포시")
  assert.deepEqual(sejong, {
    sourceCode: "3600000000",
    label: "세종특별자치시",
    queryValue: "세종특별자치시",
    provinceOnly: true,
    districts: [],
  })
})

test("Given the generated TypeScript, When regeneration is rendered, Then output is byte-for-byte deterministic", async () => {
  const expected = renderLessonRegions(
    buildLessonRegionCatalog(parseRegionSnapshot(await readFile(fixtureUrl))),
  )

  assert.equal(await readFile(generatedUrl, "utf8"), expected)
  assert.equal(lessonRegionSource.sha256, REGION_FIXTURE_SHA256)
})

test("Given tampered or malformed bytes, When the boundary parser runs, Then it rejects them", () => {
  const valid = bytesFor([headers, "1100000000,서울특별시,,,,1,1988-04-23"])
  const withoutBom = valid.subarray(3)
  const wrongHeader = bytesFor([
    headers.replace("법정동코드", "잘못된헤더"),
    "1100000000,서울특별시,,,,1,1988-04-23",
  ])
  const malformed = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    encoder.encode(`${headers}\r\n"unclosed`),
  ])

  assert.throws(() => parseRegionSnapshot(valid, "0".repeat(64)), /SHA-256 mismatch/u)
  assert.throws(
    () => parseRegionSnapshot(withoutBom, createHash("sha256").update(withoutBom).digest("hex")),
    /UTF-8 BOM is required/u,
  )
  assert.throws(
    () => parseRegionSnapshot(malformed, createHash("sha256").update(malformed).digest("hex")),
    /unclosed quoted field/u,
  )
  assert.throws(
    () => parseRegionSnapshot(wrongHeader, createHash("sha256").update(wrongHeader).digest("hex")),
    /headers do not match/u,
  )
})

test("Given duplicate, blank, or wrong-parent rows, When parsed, Then structural errors are rejected", () => {
  assert.throws(
    () =>
      parseInMemory([
        "1100000000,서울특별시,,,,1,1988-04-23",
        "1100000000,서울특별시,,,,2,1988-04-23",
      ]),
    /duplicate code/u,
  )
  assert.throws(
    () =>
      parseInMemory([
        "1100000000,서울특별시,,,,1,1988-04-23",
        "1111000000,서울특별시,종로구,,,1,1988-04-23",
        "1112000000,서울특별시,종로구,,,2,1988-04-23",
      ]),
    /duplicate district name/u,
  )
  assert.throws(() => parseInMemory(["1100000000,,,,,1,1988-04-23"]), /blank province/u)
  assert.throws(
    () =>
      parseInMemory([
        "1100000000,서울특별시,,,,1,1988-04-23",
        "1111010100,서울특별시,종로구,청운동,,1,1988-04-23",
      ]),
    /missing district parent/u,
  )
  assert.throws(
    () =>
      parseInMemory([
        "1100000000,서울특별시,,,,1,1988-04-23",
        "2611000000,서울특별시,종로구,,,1,1988-04-23",
      ]),
    /wrong province parent/u,
  )
})

test("Given a fake Sejong second-level district, When the catalog is built, Then it is rejected", () => {
  const snapshot = parseInMemory([
    "3600000000,세종특별자치시,,,,17,2012-07-01",
    "3612000000,세종특별자치시,가짜구,,,1,2026-06-30",
  ])

  assert.throws(() => buildLessonRegionCatalog(snapshot), /fake Sejong district/u)
})
