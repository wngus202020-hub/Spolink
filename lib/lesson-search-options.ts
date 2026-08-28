const koreanCollator = new Intl.Collator("ko-KR")

type RegionDistrict = Readonly<{
  code: string
  label: string
  queryValue: string
}>

type Region = Readonly<{
  districts: readonly RegionDistrict[]
  label: string
  queryValue: string
  sourceCode: string
}>

export type LessonRegionSearchOption<TRegion extends Region> = Readonly<{
  category: TRegion
  key: string
  label: string
  value: string
}>

export function sortLessonRegions<TRegion extends Region>(regions: readonly TRegion[]) {
  return regions.toSorted((left, right) => compareKoreanText(left.label, right.label))
}

export function sortSportFilters(filters: readonly string[]): readonly string[] {
  const [allOption, ...options] = filters
  return allOption ? [allOption, ...options.toSorted(compareKoreanText)] : []
}

export function sortRegionDistricts<TDistrict extends RegionDistrict>(
  districts: readonly TDistrict[],
) {
  return districts.toSorted((left, right) => compareKoreanText(left.label, right.label))
}

export function searchRegionOptions<TRegion extends Region>(
  regions: readonly TRegion[],
  query: string,
): readonly LessonRegionSearchOption<TRegion>[] {
  const normalizedQuery = normalizeSearchText(query)

  if (!normalizedQuery) return []

  return sortLessonRegions(regions)
    .flatMap((category) => [
      {
        category,
        key: category.sourceCode,
        label: `${category.label} 전체`,
        value: category.queryValue,
      },
      ...sortRegionDistricts(category.districts).map((district) => ({
        category,
        key: district.code,
        label: `${category.label} · ${district.label}`,
        value: district.queryValue,
      })),
    ])
    .filter(
      (option) =>
        normalizeSearchText(option.label).includes(normalizedQuery) ||
        normalizeSearchText(option.value).includes(normalizedQuery),
    )
    .toSorted(
      (left, right) =>
        compareKoreanText(left.label, right.label) || left.key.localeCompare(right.key),
    )
}

export function filterSportOptions(filters: readonly string[], query: string): readonly string[] {
  const sortedFilters = sortSportFilters(filters)
  const normalizedQuery = normalizeSearchText(query)

  if (!normalizedQuery) return sortedFilters

  return sortedFilters.filter((option) => normalizeSearchText(option).includes(normalizedQuery))
}

function compareKoreanText(left: string, right: string) {
  return koreanCollator.compare(left, right)
}

function normalizeSearchText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}
