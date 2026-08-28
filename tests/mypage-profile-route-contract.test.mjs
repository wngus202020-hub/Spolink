import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { inspectRenderedHtml } from "./react-html-runtime.mjs"
import { captureRouteSignal, configureReservationPageRuntime } from "./reservation-page-runtime.mjs"

const read = (path) => readFile(path, "utf8")

const readyProfile = {
  default_region: "서울특별시 강남구",
  display_name: "테스트 표시 이름",
  location_agreed_at: null,
  marketing_agreed_at: "2026-08-22T00:00:00.000Z",
  phone: "01000000000",
  real_name: "테스트 이름",
}

test("profile edit route keeps the shared My Page authentication boundary", async () => {
  const page = await read("app/mypage/profile/page.tsx")

  assert.match(page, /export const dynamic = "force-dynamic"/u)
  assert.match(page, /export const revalidate = 0/u)
  assert.equal((page.match(/readPageAuthProfile\(\)/gu) ?? []).length, 1)
  assert.match(page, /redirect\("\/auth\/login\?next=\/mypage\/profile"\)/u)
  assert.match(page, /redirect\("\/onboarding\/profile"\)/u)
  assert.doesNotMatch(page, /account_(?:suspended|deleted)/u)
  assert.match(page, /<PublicHeader auth=\{auth\} \/>/u)
})

test("profile edit route redirects unavailable and profile-required states before reading profile data", async (t) => {
  const pageModule = await import("../app/mypage/profile/page.tsx")

  for (const [auth, destination] of [
    [{ kind: "unauthenticated" }, "/auth/login?next=/mypage/profile"],
    [{ kind: "unconfigured" }, "/auth/login?next=/mypage/profile"],
    [{ kind: "profile_required" }, "/onboarding/profile"],
  ]) {
    await t.test(auth.kind, async () => {
      configureReservationPageRuntime({ auth })

      assert.deepEqual(await captureRouteSignal(() => pageModule.default()), {
        destination,
        kind: "redirect",
      })
    })
  }
})

test("profile edit route prepares only the approved six-field initial state", async () => {
  const page = await read("app/mypage/profile/page.tsx")

  assert.match(
    page,
    /const initialProfile = \{[\s\S]*displayName: auth\.profile\.display_name,[\s\S]*realName: auth\.profile\.real_name,[\s\S]*phone: auth\.profile\.phone,[\s\S]*defaultRegion: auth\.profile\.default_region,[\s\S]*locationAgreed: auth\.profile\.location_agreed_at !== null,[\s\S]*marketingAgreed: auth\.profile\.marketing_agreed_at !== null,[\s\S]*\}/u,
  )
  assert.doesNotMatch(page, /fetch\(\s*["']\/api\/me/u)
  assert.doesNotMatch(page, /createSupabase(?:Server|Service|ServerComponent)Client/u)
  assert.doesNotMatch(page, /method=\{?["'](?:POST|PATCH|PUT|DELETE)/u)
})

test("profile edit route renders consent current state from timestamp nullness", async () => {
  const pageModule = await import("../app/mypage/profile/page.tsx")
  configureReservationPageRuntime({ auth: { kind: "ready", profile: readyProfile } })

  const element = await pageModule.default()
  await inspectRenderedHtml(element, async ({ page }) => {
    assert.equal(
      await page.locator('input[name="displayName"]').inputValue(),
      readyProfile.display_name,
    )
    assert.equal(await page.locator('input[name="realName"]').inputValue(), readyProfile.real_name)
    assert.equal(await page.locator('input[name="phone"]').inputValue(), readyProfile.phone)
    assert.equal(await page.locator('input[name="locationAgreed"]').isChecked(), false)
    assert.equal(await page.locator('input[name="marketingAgreed"]').isChecked(), true)
    assert.equal(await page.locator("dd").count(), 0)
  })
})

test("profile edit route-local states preserve the shell and safe recovery", async () => {
  const [loading, error] = await Promise.all([
    read("app/mypage/profile/loading.tsx"),
    read("app/mypage/profile/error.tsx"),
  ])

  assert.match(loading, /aria-busy="true"/u)
  assert.match(loading, /min-h-\[100dvh\]/u)
  assert.match(loading, /max-w-\[760px\]/u)
  assert.match(loading, /h-\d+/u)
  assert.match(error, /^"use client"/u)
  assert.match(error, /role="alert"/u)
  assert.match(error, /다시 시도/u)
  assert.match(error, /onClick=\{reset\}/u)
  assert.doesNotMatch(error, /error\.(?:message|stack|cause)/u)
})
