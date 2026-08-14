import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { readFavoriteLessonsData } from "../lib/favorites/read-model.ts"

const learnerId = "00000000-0000-4000-8000-000000000001"

test("favorite lessons reader returns owned newest-first display-safe rows", async () => {
  const calls = []
  const data = await readFavoriteLessonsData(learnerId, async (...args) => {
    calls.push(args)
    return favoriteSnapshot()
  })

  assert.deepEqual(calls, [[learnerId]])
  assert.equal(data.state, "ready")
  assert.deepEqual(
    data.viewModel.items.map((item) => item.title),
    ["저녁 테니스", "아침 필라테스"],
  )
  assert.equal(data.viewModel.items[0].coachName, "김코치")
  assert.equal(data.viewModel.items[0].priceText, "45,000원")
  assert.equal(data.viewModel.items[0].savedAtText, "2026. 7. 28.")
  assert.equal(data.viewModel.items[0].canViewDetail, true)
  assert.doesNotMatch(JSON.stringify(data), /favorite-1|learnerId|learner_id|user_id|service_role/u)
})

test("favorite lessons reader keeps unavailable favorites without detail links", async () => {
  const data = await readFavoriteLessonsData(learnerId, async () =>
    favoriteSnapshot({ lessons: [], sports: [] }),
  )

  assert.equal(data.state, "ready")
  assert.equal(data.viewModel.items[0].canViewDetail, false)
  assert.equal(data.viewModel.items[0].statusLabel, "공개 중단")
  assert.equal(data.viewModel.items[0].title, "더 이상 공개되지 않는 레슨")
})

test("favorite lessons reader returns empty and read-failure states", async () => {
  const empty = await readFavoriteLessonsData(learnerId, async () =>
    favoriteSnapshot({ favorites: [] }),
  )
  const failed = await readFavoriteLessonsData(learnerId, async () => ({ kind: "read_failure" }))
  const thrown = await readFavoriteLessonsData(learnerId, async () => {
    throw new Error("database unavailable")
  })

  assert.equal(empty.state, "empty")
  assert.deepEqual(empty.viewModel.items, [])
  assert.deepEqual(failed, { state: "read_failure", viewModel: null })
  assert.deepEqual(thrown, { state: "read_failure", viewModel: null })
})

test("actual favorites reader scopes by learner before service enrichment", async () => {
  const source = await readFile(new URL("../lib/favorites/read-model.ts", import.meta.url), "utf8")
  const reader = source.slice(
    source.indexOf("export async function readFavoriteLessonsSnapshot"),
    source.indexOf("function mapFavoriteSnapshot"),
  )
  const enrichment = source.slice(source.indexOf("async function enrichFavoriteLessons"))

  assert.ok(reader.indexOf('.eq("learner_id", learnerId)') >= 0)
  assert.match(reader, /\.limit\(FAVORITE_LESSONS_LIMIT\)/u)
  assert.ok(reader.indexOf("favorites.length === 0") < reader.indexOf("enrichFavoriteLessons"))
  assert.match(enrichment, /\.eq\("status", "active"\)/u)
  assert.match(enrichment, /from\("coach_profile_public_cards"\)/u)
  assert.match(enrichment, /createSupabaseServiceClient\(\)/u)
  assert.match(enrichment, /\.in\("id", lessonIds\)/u)
  assert.doesNotMatch(enrichment, /serviceSupabase\s*\n?\s*\.from\("lessons"\)/u)
  assert.doesNotMatch(enrichment, /provider_payment_key|provider_refund_key|raw_payload/u)
})

function favoriteSnapshot(overrides = {}) {
  return {
    coaches: [{ displayName: "김코치", id: "coach-1" }],
    favorites: [
      favoriteRow({ createdAt: "2026-07-28T00:00:00.000Z", lessonId: "lesson-2" }),
      favoriteRow({ createdAt: "2026-07-27T00:00:00.000Z", lessonId: "lesson-1" }),
    ],
    kind: "found",
    lessons: [
      lessonSnapshot(),
      lessonSnapshot({
        coachProfileId: "coach-1",
        id: "lesson-2",
        priceAmount: 45_000,
        sportId: "sport-1",
        title: "저녁 테니스",
      }),
    ],
    sports: [{ id: "sport-1", name: "테니스" }],
    ...overrides,
  }
}

function favoriteRow(overrides = {}) {
  return {
    createdAt: "2026-07-27T00:00:00.000Z",
    id: "favorite-1",
    lessonId: "lesson-1",
    ...overrides,
  }
}

function lessonSnapshot(overrides = {}) {
  return {
    coachProfileId: "coach-1",
    id: "lesson-1",
    placeName: "강남 스튜디오",
    priceAmount: 30_000,
    region: "서울 강남구",
    sportId: "sport-1",
    status: "active",
    title: "아침 필라테스",
    ...overrides,
  }
}
