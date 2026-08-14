import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const read = (path) => readFile(path, "utf8")

test("Todo 6 onboarding and session shell boundaries are present", async () => {
  const [page, form, header, pageAuth, booking, layout] = await Promise.all([
    read("app/onboarding/profile/page.tsx"),
    read("components/onboarding/profile-onboarding-form.tsx"),
    read("components/layout/public-header.tsx"),
    read("lib/auth/page-auth.ts"),
    read("app/lessons/[lessonId]/booking/page.tsx"),
    read("app/layout.tsx"),
  ])

  assert.match(page, /dynamic = "force-dynamic"/)
  assert.match(page, /redirect\("\/auth\/login\?next=\/onboarding\/profile"\)/)
  assert.match(page, /redirect\("\/lessons"\)/)
  assert.match(form, /fetch\("\/api\/profiles"/)
  assert.doesNotMatch(form, /\b(?:role|status)\s*:/)
  assert.doesNotMatch(form, /\b(?:intent|metadata)\s*:/)
  assert.doesNotMatch(form, /localStorage|sessionStorage/)
  for (const field of [
    "displayName",
    "realName",
    "phone",
    "defaultRegion",
    "locationAgreed",
    "marketingAgreed",
  ]) {
    assert.match(form, new RegExp(field))
  }
  assert.match(header, /action="\/auth\/logout" method="post"/)
  assert.match(header, /프로필 설정/)
  assert.match(pageAuth, /\/auth\/restricted\?reason=account-suspended/)
  assert.match(pageAuth, /\/auth\/restricted\?reason=account-deleted/)
  assert.match(booking, /redirect\(`\/auth\/login\?next=\$\{bookingPath\}`\)/)
  assert.match(booking, /redirect\("\/onboarding\/profile"\)/)
  assert.doesNotMatch(layout, /"use client"/)
})

test("profile onboarding keeps exact create-profile request boundary", async () => {
  const form = await read("components/onboarding/profile-onboarding-form.tsx")
  const requestLiteral = form.match(/const request = \{[\s\S]*?\n {4}\}/)?.[0]

  assert.ok(requestLiteral, "Profile create request literal must stay explicit.")
  for (const field of [
    "defaultRegion",
    "displayName",
    "locationAgreed",
    "marketingAgreed",
    "phone",
    "realName",
  ]) {
    assert.match(requestLiteral, new RegExp(`${field}:`))
  }
  assert.doesNotMatch(requestLiteral, /\b(?:intent|role|status|metadata|auth)\s*:/)
})

test("profile onboarding UI uses existing tokenized styling", async () => {
  const [page, form] = await Promise.all([
    read("app/onboarding/profile/page.tsx"),
    read("components/onboarding/profile-onboarding-form.tsx"),
  ])
  const source = `${page}\n${form}`

  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/)
  assert.doesNotMatch(source, /style=\{\{/)
  assert.match(source, /필수/)
  assert.match(source, /선택/)
  assert.match(source, /레슨 찾기 시작/)
  assert.match(source, /지도자 등록으로 이동/)
})
