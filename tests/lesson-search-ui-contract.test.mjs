import assert from "node:assert/strict"
import test from "node:test"

import { lessonRegionSource, lessonRegions } from "../lib/lesson-regions.ts"
import { includesFilter, sportFilters } from "../lib/lesson-search.ts"

test("official region catalog exposes canonical province and district query values", () => {
  // Given: the generated official legal-district snapshot consumed by search.
  const gyeonggi = lessonRegions.find((region) => region.label === "경기도")

  // When: a canonical district is selected from the public catalog.
  const suwonJangan = gyeonggi?.districts.find((district) => district.label === "수원시장안구")

  // Then: the snapshot identity and submitted query value remain official and complete.
  assert.deepEqual(lessonRegionSource, {
    snapshotDate: "2026-06-30",
    sha256: "accc0a93dddefc5e01135d133fbdcd3425d24a8aeb14b90c928f8a1d680f7647",
    url: "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003676587&fileDetailSn=1&insertDataPrcus=N",
  })
  assert.equal(lessonRegions.length, 17)
  assert.equal(suwonJangan?.queryValue, "경기도 수원시장안구")
})

test("search choices cover nationwide discovery and common sports", () => {
  assert.equal(includesFilter("서울특별시 강남구", "전국"), true)
  assert.deepEqual(sportFilters, [
    "전체",
    "축구",
    "야구",
    "농구",
    "배드민턴",
    "테니스",
    "탁구",
    "골프",
    "수영",
    "필라테스",
    "요가",
    "러닝",
    "클라이밍",
    "복싱",
    "배구",
    "사이클",
  ])
})
