export type SearchParams = Record<string, string | string[] | undefined>

export type FilterState = Readonly<{
  date: string
  region: string
  sport: string
}>

export type KstDateRange = Readonly<{
  from: string
  toExclusive: string
}>

type SearchableLesson = Readonly<{
  schedules: readonly Readonly<{
    isOpen?: boolean
    remainingCount?: number
    startsAt?: string
  }>[]
}>

export const allRegionsFilterValue = "전국"

export const sportFilters = [
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
] as const

export const defaultFilterValues: FilterState = {
  date: "",
  region: "서울",
  sport: "",
}

export function getFirstParam(params: SearchParams, keys: readonly string[]) {
  for (const key of keys) {
    const value = params[key]

    if (Array.isArray(value)) {
      const firstValue = value.at(0)

      if (firstValue) {
        return firstValue
      }

      continue
    }

    if (value) {
      return value
    }
  }

  return ""
}

export function normalizeFilter(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

export function includesFilter(source: string, query: string) {
  const normalizedQuery = normalizeFilter(query)

  if (!normalizedQuery || normalizedQuery === normalizeFilter(allRegionsFilterValue)) {
    return true
  }

  return normalizeFilter(source).includes(normalizedQuery)
}

export function readFilters(params: SearchParams): FilterState {
  const sport = getFirstParam(params, ["sport", "종목"])
  const date = getFirstParam(params, ["date", "일정"])

  return {
    date: parseKstDateRange(date) ? date : defaultFilterValues.date,
    region: getFirstParam(params, ["region", "지역"]) || defaultFilterValues.region,
    sport: sport === "전체" ? "" : sport,
  }
}

export function parseKstDateRange(value: string): KstDateRange | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)

  if (!match) {
    return undefined
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const calendarDate = new Date(Date.UTC(year, month - 1, day))

  if (
    year < 1_000 ||
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return undefined
  }

  const kstOffsetMilliseconds = 9 * 60 * 60 * 1_000
  const fromMilliseconds = calendarDate.getTime() - kstOffsetMilliseconds
  const dayMilliseconds = 24 * 60 * 60 * 1_000

  return {
    from: new Date(fromMilliseconds).toISOString(),
    toExclusive: new Date(fromMilliseconds + dayMilliseconds).toISOString(),
  }
}

export function matchesLessonSearchDate(lesson: SearchableLesson, range: KstDateRange) {
  const fromMilliseconds = Date.parse(range.from)
  const toExclusiveMilliseconds = Date.parse(range.toExclusive)

  return lesson.schedules.some((schedule) => {
    const remainingCount = schedule.remainingCount

    if (
      schedule.isOpen !== true ||
      typeof remainingCount !== "number" ||
      !Number.isFinite(remainingCount) ||
      !Number.isInteger(remainingCount) ||
      remainingCount <= 0 ||
      !schedule.startsAt
    ) {
      return false
    }

    const startsAtMilliseconds = Date.parse(schedule.startsAt)

    return (
      Number.isFinite(startsAtMilliseconds) &&
      startsAtMilliseconds >= fromMilliseconds &&
      startsAtMilliseconds < toExclusiveMilliseconds
    )
  })
}

export function buildLessonsHref(filters: FilterState, nextSport: string) {
  const nextParams = new URLSearchParams()

  if (filters.region) {
    nextParams.set("region", filters.region)
  }

  if (filters.date) {
    nextParams.set("date", filters.date)
  }

  if (nextSport && nextSport !== "전체") {
    nextParams.set("sport", nextSport)
  }

  const query = nextParams.toString()

  return query ? `/lessons?${query}` : "/lessons"
}
