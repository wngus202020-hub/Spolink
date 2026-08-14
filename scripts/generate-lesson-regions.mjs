import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
export const REGION_FIXTURE_SHA256 =
  "accc0a93dddefc5e01135d133fbdcd3425d24a8aeb14b90c928f8a1d680f7647"
export const REGION_SOURCE_URL =
  "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003676587&fileDetailSn=1&insertDataPrcus=N"
export const REGION_HEADERS = [
  "법정동코드",
  "시도명",
  "시군구명",
  "읍면동명",
  "리명",
  "순위",
  "생성일자",
]
const FIXTURE_URL = new URL(
  "../tests/fixtures/regions/molit-legal-districts-20260630.csv",
  import.meta.url,
)
const OUTPUT_URL = new URL("../lib/lesson-regions.ts", import.meta.url)
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
const SEJONG = "세종특별자치시"
const INTEGRATED_PROVINCE = "전남광주통합특별시"
const PROVINCE_ORDER = [
  "서울특별시",
  "부산광역시",
  "대구광역시",
  "인천광역시",
  "광주광역시",
  "대전광역시",
  "울산광역시",
  SEJONG,
  "경기도",
  "강원특별자치도",
  "충청북도",
  "충청남도",
  "전북특별자치도",
  "전라남도",
  "경상북도",
  "경상남도",
  "제주특별자치도",
]
export class RegionFixtureError extends Error {
  constructor(reason) {
    super(`Invalid region fixture: ${reason}`)
    this.name = "RegionFixtureError"
    this.reason = reason
  }
}
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ""
  let quoted = false
  let closedQuote = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
        closedQuote = true
      } else {
        field += character
      }
    } else if (closedQuote && character !== "," && character !== "\r" && character !== "\n") {
      throw new RegionFixtureError("characters follow a closing quote")
    } else if (character === '"') {
      if (field.length > 0) throw new RegionFixtureError("quote appears inside an unquoted field")
      quoted = true
    } else if (character === ",") {
      row.push(field)
      field = ""
      closedQuote = false
    } else if (character === "\n") {
      row.push(field)
      rows.push(row)
      row = []
      field = ""
      closedQuote = false
    } else if (character === "\r") {
      if (text[index + 1] !== "\n") throw new RegionFixtureError("bare carriage return")
    } else {
      field += character
    }
  }
  if (quoted) throw new RegionFixtureError("unclosed quoted field")
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}
export function parseRegionSnapshot(bytes, expectedSha256 = REGION_FIXTURE_SHA256) {
  const actualSha256 = createHash("sha256").update(bytes).digest("hex")
  if (actualSha256 !== expectedSha256) {
    throw new RegionFixtureError(
      `SHA-256 mismatch: expected ${expectedSha256}, received ${actualSha256}`,
    )
  }
  if (!bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)) {
    throw new RegionFixtureError("UTF-8 BOM is required")
  }
  let text
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(UTF8_BOM.length))
  } catch (error) {
    if (error instanceof TypeError) throw new RegionFixtureError("body is not valid UTF-8")
    throw error
  }
  const rows = parseCsv(text)
  const header = rows.shift()
  if (
    !header ||
    header.length !== REGION_HEADERS.length ||
    header.some((value, i) => value !== REGION_HEADERS[i])
  ) {
    throw new RegionFixtureError("headers do not match the required schema")
  }
  if (rows.length === 0) throw new RegionFixtureError("snapshot has no data rows")
  const parsedRows = rows.map((columns, index) => {
    if (columns.length !== REGION_HEADERS.length) {
      throw new RegionFixtureError(`row ${index + 2} has ${columns.length} columns`)
    }
    const [code, province, district, neighborhood, village, , createdAt] = columns
    if (!code || !/^\d{10}$/u.test(code))
      throw new RegionFixtureError(`row ${index + 2} has an invalid code`)
    if (!province) throw new RegionFixtureError(`row ${index + 2} has a blank province`)
    if (village && !neighborhood)
      throw new RegionFixtureError(`row ${index + 2} has a village without a parent`)
    if (!createdAt || !/^\d{4}-\d{2}-\d{2}$/u.test(createdAt)) {
      throw new RegionFixtureError(`row ${index + 2} has invalid metadata`)
    }
    return { code, province, district, neighborhood, village }
  })
  const codes = new Set()
  const provinceRoots = new Map()
  const districtRoots = new Map()
  for (const row of parsedRows) {
    if (codes.has(row.code)) throw new RegionFixtureError(`duplicate code ${row.code}`)
    codes.add(row.code)
    if (!row.district && !row.neighborhood && !row.village) {
      if (provinceRoots.has(row.province))
        throw new RegionFixtureError(`duplicate province name ${row.province}`)
      provinceRoots.set(row.province, row.code)
    }
    if (row.district && !row.neighborhood && !row.village) {
      const key = `${row.province}\u0000${row.district}`
      if (districtRoots.has(key))
        throw new RegionFixtureError(`duplicate district name ${row.district}`)
      districtRoots.set(key, row.code)
    }
  }
  for (const row of parsedRows) {
    const provinceCode = provinceRoots.get(row.province)
    if (!provinceCode) throw new RegionFixtureError(`missing province parent for ${row.code}`)
    if (!row.code.startsWith(provinceCode.slice(0, 2)))
      throw new RegionFixtureError(`wrong province parent for ${row.code}`)
    if (row.district) {
      const districtCode = districtRoots.get(`${row.province}\u0000${row.district}`)
      if (!districtCode) throw new RegionFixtureError(`missing district parent for ${row.code}`)
      if (!row.code.startsWith(districtCode.slice(0, 5)))
        throw new RegionFixtureError(`wrong district parent for ${row.code}`)
    }
  }
  return { districtRoots, provinceRoots }
}
function canonicalProvince(sourceProvince, districtCode) {
  if (sourceProvince !== INTEGRATED_PROVINCE) return sourceProvince
  return districtCode.startsWith("122") || districtCode.startsWith("123")
    ? "광주광역시"
    : "전라남도"
}

export function buildLessonRegionCatalog(snapshot) {
  const districtsByProvince = new Map(PROVINCE_ORDER.map((label) => [label, []]))
  for (const [key, code] of snapshot.districtRoots) {
    const [sourceProvince, district] = key.split("\u0000")
    if (!sourceProvince || !district) throw new RegionFixtureError("district key is malformed")
    if (sourceProvince === SEJONG) {
      if (district !== "세종시") throw new RegionFixtureError(`fake Sejong district ${district}`)
      continue
    }
    const province = canonicalProvince(sourceProvince, code)
    const target = districtsByProvince.get(province)
    if (!target) throw new RegionFixtureError(`unexpected province ${sourceProvince}`)
    target.push({ code, label: district, queryValue: `${province} ${district}` })
  }

  return PROVINCE_ORDER.map((label) => {
    const sourceLabel = label === "광주광역시" || label === "전라남도" ? INTEGRATED_PROVINCE : label
    const sourceCode = snapshot.provinceRoots.get(sourceLabel)
    if (!sourceCode) throw new RegionFixtureError(`missing required province ${label}`)
    const districts = districtsByProvince.get(label)
    if (!districts) throw new RegionFixtureError(`missing district bucket ${label}`)
    districts.sort((left, right) => left.code.localeCompare(right.code))
    return { sourceCode, label, queryValue: label, provinceOnly: label === SEJONG, districts }
  })
}

export function renderLessonRegions(catalog) {
  const renderedCatalog = catalog
    .map((province) => {
      const districts = province.districts
        .map(
          (district) => `      {
        code: ${JSON.stringify(district.code)},
        label: ${JSON.stringify(district.label)},
        queryValue: ${JSON.stringify(district.queryValue)},
      },`,
        )
        .join("\n")
      return `  {
    sourceCode: ${JSON.stringify(province.sourceCode)},
    label: ${JSON.stringify(province.label)},
    queryValue: ${JSON.stringify(province.queryValue)},
    provinceOnly: ${province.provinceOnly},
    districts: [${districts ? `\n${districts}\n    ` : ""}],
  },`
    })
    .join("\n")

  return `// Generated by scripts/generate-lesson-regions.mjs. Do not edit manually.\n\nexport type LessonRegionDistrict = Readonly<{\n  code: string\n  label: string\n  queryValue: string\n}>\n\nexport type LessonRegion = Readonly<{\n  sourceCode: string\n  label: string\n  queryValue: string\n  provinceOnly: boolean\n  districts: readonly LessonRegionDistrict[]\n}>\n\nexport const lessonRegionSource = {\n  snapshotDate: "2026-06-30",\n  sha256: "${REGION_FIXTURE_SHA256}",\n  url: "${REGION_SOURCE_URL}",\n} as const\n\nexport const lessonRegions = [\n${renderedCatalog}\n] as const satisfies readonly LessonRegion[]\n`
}

export async function generateLessonRegions({ check = false } = {}) {
  const bytes = await readFile(FIXTURE_URL)
  const output = renderLessonRegions(buildLessonRegionCatalog(parseRegionSnapshot(bytes)))
  if (check) {
    const current = await readFile(OUTPUT_URL, "utf8")
    if (current !== output) throw new RegionFixtureError("generated catalog is stale")
    return
  }
  await writeFile(OUTPUT_URL, output, "utf8")
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))
) {
  const argument = process.argv[2]
  if (argument && argument !== "--check")
    throw new RegionFixtureError(`unknown argument ${argument}`)
  await generateLessonRegions({ check: argument === "--check" })
}
