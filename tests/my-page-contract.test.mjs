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
  const page = await read("app/mypage/page.tsx")

  assert.match(page, /readPageAuthProfile/u)
  assert.match(page, /redirect\("\/auth\/login\?next=\/mypage"\)/u)
  assert.match(page, /redirect\("\/onboarding\/profile"\)/u)
  assert.match(page, /href="\/mypage\/reservations"/u)
  assert.match(page, /href="\/mypage\/favorites"/u)
  assert.match(page, /찜한 레슨/u)
})

test("favorites route keeps My Page auth gates and no mutation endpoints", async () => {
  const [page, readModel] = await Promise.all([
    read("app/mypage/favorites/page.tsx"),
    read("lib/favorites/read-model.ts"),
  ])

  assert.match(page, /redirect\("\/auth\/login\?next=\/mypage\/favorites"\)/u)
  assert.match(page, /redirect\("\/onboarding\/profile"\)/u)
  assert.match(page, /readFavoriteLessonsData\(auth\.profile\.id\)/u)
  assert.match(page, /아직 찜한 레슨이 없어요/u)
  assert.match(page, /favorite\.canViewDetail/u)
  assert.match(page, /공개 중단/u)
  assert.doesNotMatch(readModel, /id: favorite\.id/u)
  assert.doesNotMatch(`${page}\n${readModel}`, /fetch\(|method:\s*"(?:POST|DELETE|PATCH)"/u)
})
