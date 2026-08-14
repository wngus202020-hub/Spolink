import type { Database } from "@/lib/supabase/database.types"

type FavoriteSnapshot = Readonly<{
  createdAt: string
  lessonId: string
}>

type LessonSnapshot = Readonly<{
  coachProfileId: string
  id: string
  placeName: string | null
  priceAmount: number
  region: string
  sportId: string
  status: Database["public"]["Enums"]["lesson_status"]
  title: string
}>

type CoachSnapshot = Readonly<{
  displayName: string
  id: string
}>

type SportSnapshot = Readonly<{
  id: string
  name: string
}>

type FavoriteEnrichment = Readonly<{
  coaches: readonly CoachSnapshot[]
  lessons: readonly LessonSnapshot[]
  sports: readonly SportSnapshot[]
}>

export type FavoriteLessonsReadSnapshot = Readonly<
  | ({ favorites: readonly FavoriteSnapshot[]; kind: "found" } & FavoriteEnrichment)
  | { kind: "read_failure" }
>

export type FavoriteLessonView = Readonly<{
  canViewDetail: boolean
  coachName: string | null
  lessonId: string
  location: string
  priceText: string
  savedAtText: string
  sportName: string | null
  statusLabel: string
  title: string
}>

export type FavoriteLessonsData = Readonly<{
  state: "empty" | "read_failure" | "ready"
  viewModel: Readonly<{
    items: readonly FavoriteLessonView[]
  }> | null
}>

export type FavoriteLessonsRead = (learnerId: string) => Promise<FavoriteLessonsReadSnapshot>

export const FAVORITE_LESSONS_LIMIT = 20

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeZone: "Asia/Seoul",
})

const lessonStatusLabels: Record<Database["public"]["Enums"]["lesson_status"], string> = {
  active: "예약 가능",
  closed: "마감",
  draft: "작성 중",
  paused: "일시 중지",
  pending_review: "검수 중",
  rejected: "반려",
}

export async function readFavoriteLessonsData(
  learnerId: string,
  read: FavoriteLessonsRead = readFavoriteLessonsSnapshot,
): Promise<FavoriteLessonsData> {
  let snapshot: FavoriteLessonsReadSnapshot
  try {
    snapshot = await read(learnerId)
  } catch {
    snapshot = { kind: "read_failure" }
  }

  if (snapshot.kind === "read_failure") {
    return { state: "read_failure", viewModel: null }
  }

  const lessonsById = indexById(snapshot.lessons)
  const coachesById = indexById(snapshot.coaches)
  const sportsById = indexById(snapshot.sports)
  const items = snapshot.favorites.map((favorite) => {
    const lesson = lessonsById.get(favorite.lessonId)
    if (!lesson) {
      return {
        canViewDetail: false,
        coachName: null,
        lessonId: favorite.lessonId,
        location: "레슨 공개 상태 확인 필요",
        priceText: "가격 확인 필요",
        savedAtText: formatSavedAt(favorite.createdAt),
        sportName: null,
        statusLabel: "공개 중단",
        title: "더 이상 공개되지 않는 레슨",
      }
    }

    const coach = coachesById.get(lesson.coachProfileId) ?? null
    const sport = sportsById.get(lesson.sportId) ?? null

    return {
      canViewDetail: true,
      coachName: coach?.displayName ?? null,
      lessonId: favorite.lessonId,
      location: formatLocation(lesson.region, lesson.placeName),
      priceText: `${lesson.priceAmount.toLocaleString("ko-KR")}원`,
      savedAtText: formatSavedAt(favorite.createdAt),
      sportName: sport?.name ?? null,
      statusLabel: lessonStatusLabels[lesson.status],
      title: lesson.title,
    }
  })

  return {
    state: items.length === 0 ? "empty" : "ready",
    viewModel: { items },
  }
}

export async function readFavoriteLessonsSnapshot(
  learnerId: string,
): Promise<FavoriteLessonsReadSnapshot> {
  try {
    const { createSupabaseServerComponentClient } = await import("@/lib/auth/server-profile")
    const supabase = await createSupabaseServerComponentClient()
    const favoriteResult = await supabase
      .from("lesson_favorites")
      .select("id,lesson_id,created_at")
      .eq("learner_id", learnerId)
      .order("created_at", { ascending: false })
      .limit(FAVORITE_LESSONS_LIMIT)

    if (favoriteResult.error) return { kind: "read_failure" }

    const favorites = (favoriteResult.data ?? []).map(mapFavoriteSnapshot)
    if (favorites.length === 0) {
      return { coaches: [], favorites, kind: "found", lessons: [], sports: [] }
    }

    const enrichment = await enrichFavoriteLessons(favorites)
    if (!enrichment) return { kind: "read_failure" }

    return { ...enrichment, favorites, kind: "found" }
  } catch {
    return { kind: "read_failure" }
  }
}

function mapFavoriteSnapshot(row: {
  created_at: string
  id: string
  lesson_id: string
}): FavoriteSnapshot {
  return {
    createdAt: row.created_at,
    lessonId: row.lesson_id,
  }
}

async function enrichFavoriteLessons(
  favorites: readonly FavoriteSnapshot[],
): Promise<FavoriteEnrichment | null> {
  const { createSupabaseServerComponentClient } = await import("@/lib/auth/server-profile")
  const supabase = await createSupabaseServerComponentClient()
  const lessonIds = unique(favorites.map((favorite) => favorite.lessonId))

  const lessonResult = await supabase
    .from("lessons")
    .select("id,title,region,place_name,price_amount,status,sport_id,coach_profile_id")
    .eq("status", "active")
    .in("id", lessonIds)

  if (lessonResult.error) return null

  const lessons = (lessonResult.data ?? []).map((lesson) => ({
    coachProfileId: lesson.coach_profile_id,
    id: lesson.id,
    placeName: lesson.place_name,
    priceAmount: lesson.price_amount,
    region: lesson.region,
    sportId: lesson.sport_id,
    status: lesson.status,
    title: lesson.title,
  }))
  const coachIds = unique(lessons.map((lesson) => lesson.coachProfileId))
  const sportIds = unique(lessons.map((lesson) => lesson.sportId))

  const [coachResult, sportResult] = await Promise.all([
    supabase.from("coach_profile_public_cards").select("id").in("id", coachIds),
    supabase.from("sports").select("id,name").in("id", sportIds),
  ])

  if (coachResult.error || sportResult.error) return null

  const publicCoachIds = new Set((coachResult.data ?? []).map((coach) => coach.id))
  const publicCoachIdList = [...publicCoachIds]
  const coachNameResult =
    publicCoachIdList.length > 0 ? await readPublicCoachNames(publicCoachIdList) : null
  if (publicCoachIdList.length > 0 && !coachNameResult) return null
  const coachNames = coachNameResult ?? new Map<string, string>()

  return {
    coaches: lessons.flatMap((lesson) =>
      publicCoachIds.has(lesson.coachProfileId)
        ? [
            {
              displayName: coachNames.get(lesson.coachProfileId) ?? "인증 지도자",
              id: lesson.coachProfileId,
            },
          ]
        : [],
    ),
    lessons,
    sports: (sportResult.data ?? []).map((sport) => ({ id: sport.id, name: sport.name })),
  }
}

async function readPublicCoachNames(
  coachProfileIds: readonly string[],
): Promise<ReadonlyMap<string, string> | null> {
  const { createSupabaseServiceClient } = await import("@/lib/supabase/server")
  const serviceSupabase = createSupabaseServiceClient()
  const coachResult = await serviceSupabase
    .from("coach_profiles")
    .select("id,user_id")
    .in("id", [...coachProfileIds])

  if (coachResult.error) return null

  const coachRows = coachResult.data ?? []
  const profileResult = await serviceSupabase
    .from("profiles")
    .select("id,display_name")
    .in("id", unique(coachRows.map((coach) => coach.user_id)))

  if (profileResult.error) return null

  const namesByUserId = new Map(
    (profileResult.data ?? []).map((profile) => [profile.id, profile.display_name]),
  )

  return new Map(
    coachRows.flatMap((coach) => {
      const displayName = namesByUserId.get(coach.user_id)
      return displayName ? [[coach.id, displayName]] : []
    }),
  )
}

function formatLocation(region: string, placeName: string | null): string {
  return placeName ? `${region} · ${placeName}` : region
}

function formatSavedAt(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "저장일 확인 필요"
  return dateFormatter.format(date)
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function indexById<Row extends Readonly<{ id: string }>>(
  rows: readonly Row[],
): ReadonlyMap<string, Row> {
  return new Map(rows.map((row) => [row.id, row]))
}
