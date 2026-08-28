import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("Given the favorite page, when an item is removed or restored, then the existing read model refreshes", async () => {
  const source = await readFile(
    new URL("../components/favorites/favorite-lessons-list.tsx", import.meta.url),
    "utf8",
  )

  assert.match(source, /mutateFavorite\("remove", item\.lessonId\)/u)
  assert.match(source, /mutateFavorite\("add", item\.lessonId\)/u)
  assert.equal(source.match(/router\.refresh\(\)/gu)?.length, 2)
  assert.match(source, /setItems\(\(current\) => current\.filter/u)
  assert.match(source, /\[item, \.\.\.current\]/u)
})

test("Given favorite mutation states, when rendered, then only errors move focus", async () => {
  const list = await readFile(
    new URL("../components/favorites/favorite-lessons-list.tsx", import.meta.url),
    "utf8",
  )
  const row = await readFile(
    new URL("../components/favorites/favorite-lesson-row.tsx", import.meta.url),
    "utf8",
  )

  assert.match(list, /if \(notice\?\.kind === "error"\) noticeRef\.current\?\.focus\(\)/u)
  assert.doesNotMatch(list, /if \(notice\) noticeRef\.current\?\.focus\(\)/u)
  assert.match(list, /role=\{isError \? "alert" : "status"\}/u)
  assert.match(list, /tabIndex=\{-1\}/u)
  assert.match(list, /다시 찜하기/u)
  assert.match(row, /aria-busy=\{pending\}/u)
  assert.match(row, /disabled=\{pending\}/u)
  assert.match(row, /삭제 중/u)
})

test("Given the 390px removed state, when Korean copy wraps, then semantic phrases stay compact", async () => {
  const list = await readFile(
    new URL("../components/favorites/favorite-lessons-list.tsx", import.meta.url),
    "utf8",
  )

  assert.match(list, /찜을 삭제했어요\./u)
  assert.match(list, /찜을 다시 저장했어요\./u)
  assert.match(list, /관심 있는 레슨을 저장해 두세요\./u)
  assert.doesNotMatch(list, /찜에서 삭제했어요|다시 확인해 봐요/u)
})

test("Given a favorite lesson card, when its title renders, then it uses the documented 18px scale", async () => {
  const row = await readFile(
    new URL("../components/favorites/favorite-lesson-row.tsx", import.meta.url),
    "utf8",
  )

  assert.match(row, /text-\[length:var\(--type-body-lg-size\)\]/u)
  assert.doesNotMatch(row, /text-xl/u)
})

test("Given full-page evidence capture, when Playwright scrolls internally, then page context is restored", async () => {
  const spec = await readFile(new URL("auth-ui-e2e/favorites.spec.ts", import.meta.url), "utf8")

  assert.match(spec, /const scrollPosition = await page\.evaluate\(\(\) => \(\{/u)
  assert.match(spec, /x: window\.scrollX/u)
  assert.match(spec, /y: window\.scrollY/u)
  assert.match(spec, /window\.scrollTo\(0, 0\)/u)
  assert.match(spec, /window\.scrollTo\(position\.x, position\.y\)/u)
  assert.match(spec, /fullPage: project === "mobile-chromium"/u)
})
