import assert from "node:assert/strict"
import test from "node:test"
import { lessonRegions } from "../lib/lesson-regions.ts"
import { sportFilters } from "../lib/lesson-search.ts"
import {
  filterSportOptions,
  searchRegionOptions,
  sortLessonRegions,
  sortRegionDistricts,
  sortSportFilters,
} from "../lib/lesson-search-options.ts"

test("search picker choices keep all controls first and sort Korean labels", () => {
  const sortedSportFilters = sortSportFilters(sportFilters)
  const sortedLessonRegions = sortLessonRegions(lessonRegions)

  assert.equal(sortedSportFilters[0], "전체")
  assert.deepEqual(sortedSportFilters.slice(1), [
    "골프",
    "농구",
    "러닝",
    "배구",
    "배드민턴",
    "복싱",
    "사이클",
    "수영",
    "야구",
    "요가",
    "축구",
    "클라이밍",
    "탁구",
    "테니스",
    "필라테스",
  ])

  const regionLabels = sortedLessonRegions.map((region) => region.label)
  assert.deepEqual(
    regionLabels,
    [...regionLabels].sort((left, right) => left.localeCompare(right, "ko-KR")),
  )

  const gyeonggi = sortedLessonRegions.find((region) => region.label === "경기도")
  assert.ok(gyeonggi)
  const districtLabels = sortRegionDistricts(gyeonggi.districts).map((district) => district.label)
  assert.deepEqual(
    districtLabels,
    [...districtLabels].sort((left, right) => left.localeCompare(right, "ko-KR")),
  )
})

test("typed region and sport text filters canonical choices without blocking custom search", () => {
  assert.deepEqual(
    searchRegionOptions(lessonRegions, "강남").map((option) => [option.label, option.value]),
    [["서울특별시 · 강남구", "서울특별시 강남구"]],
  )
  assert.deepEqual(filterSportOptions(sportFilters, "구"), ["농구", "배구", "야구", "축구", "탁구"])
  assert.deepEqual(searchRegionOptions(lessonRegions, "없는 지역"), [])
  assert.deepEqual(filterSportOptions(sportFilters, "태권도"), [])
})
