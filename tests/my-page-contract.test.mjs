import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const read = (path) => readFile(path, "utf8")

test("My Page header exposes stable ready-user 마이 navigation", async () => {
  const header = await read("components/layout/public-header.tsx")

  assert.match(header, /href="\/mypage"/u)
  assert.match(header, />\s*마이\s*</u)
  assert.match(header, /action="\/auth\/logout" method="post"/u)
  assert.match(header, /로그인/u)
  assert.match(header, /프로필 설정/u)
})

test("My Page home links implemented personal activity routes", async () => {
  const [page, coachNavigation] = await Promise.all([
    read("app/mypage/page.tsx"),
    read("lib/auth/coach-navigation.ts"),
  ])
  const personalInfoCard =
    page.match(/aria-label="내 정보 수정으로 이동"[\s\S]*?<\/Link>/u)?.[0] ?? ""

  assert.match(page, /readPageAuthProfile/u)
  assert.match(page, /redirect\("\/auth\/login\?next=\/mypage"\)/u)
  assert.match(page, /redirect\("\/onboarding\/profile"\)/u)
  assert.match(page, /aria-label="내 정보 수정으로 이동"/u)
  assert.match(page, /href="\/mypage\/profile"/u)
  assert.doesNotMatch(personalInfoCard, /준비중/u)
  const reviewCard =
    page.match(
      /<Link\s+aria-label="리뷰 관리로 이동"[\s\S]*?<MessageSquare[\s\S]*?<\/Link>/u,
    )?.[0] ?? ""
  assert.match(
    reviewCard,
    /<Link[\s\S]*?aria-label="리뷰 관리로 이동"[\s\S]*?href="\/mypage\/reviews"/u,
  )
  assert.match(reviewCard, /리뷰 내역 보기/u)
  assert.doesNotMatch(reviewCard, /준비중/u)
  assert.equal((page.match(/href="\/mypage\/reviews"/gu) ?? []).length, 1)
  assert.match(page, /href="\/mypage\/notifications"/u)
  assert.match(page, /href="\/mypage\/reservations"/u)
  assert.match(page, /href="\/mypage\/favorites"/u)
  assert.match(page, /href="\/mypage\/trust-safety"/u)
  assert.match(page, /href=\{coachNavigation\.href\}/u)
  assert.match(coachNavigation, /href: "\/coach\/apply"/u)
  assert.match(coachNavigation, /href: "\/coach\/apply\/status"/u)
  assert.match(coachNavigation, /href: "\/coach\/dashboard"/u)
  assert.match(page, /찜한 레슨/u)
})

test("favorites route keeps My Page auth gates and delegates approved mutations", async () => {
  const [page, readModel, list, row] = await Promise.all([
    read("app/mypage/favorites/page.tsx"),
    read("lib/favorites/read-model.ts"),
    read("components/favorites/favorite-lessons-list.tsx"),
    read("components/favorites/favorite-lesson-row.tsx"),
  ])

  assert.match(page, /redirect\("\/auth\/login\?next=\/mypage\/favorites"\)/u)
  assert.match(page, /redirect\("\/onboarding\/profile"\)/u)
  assert.match(page, /readFavoriteLessonsData\(auth\.profile\.id\)/u)
  assert.match(list, /아직 찜한 레슨이 없어요/u)
  assert.match(row, /favorite\.canViewDetail/u)
  assert.match(readModel, /statusLabel:\s*"공개 중단"/u)
  assert.match(list, /mutateFavorite\("remove", item\.lessonId\)/u)
  assert.match(list, /mutateFavorite\("add", item\.lessonId\)/u)
  assert.match(list, /router\.refresh\(\)/u)
  assert.doesNotMatch(readModel, /id: favorite\.id/u)
  assert.doesNotMatch(`${page}\n${readModel}`, /fetch\(|method:\s*"(?:POST|DELETE|PATCH)"/u)
})
