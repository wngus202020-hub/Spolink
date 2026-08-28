import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

function sliceSection(document, heading, nextHeading) {
  const start = document.indexOf(heading)
  assert.notEqual(start, -1, `missing heading: ${heading}`)

  const end = document.indexOf(nextHeading, start + heading.length)
  assert.notEqual(end, -1, `missing next heading: ${nextHeading}`)
  return document.slice(start, end)
}

function assertProfileDocumentationContract({ apiProfile, onboarding, profileEdit }) {
  assert.match(apiProfile, /"defaultRegion": "서울특별시 강남구"/u)
  assert.match(apiProfile, /`lessonRegions`의 province\/district canonical `queryValue`/u)
  assert.match(apiProfile, /POST의 `defaultRegion`은 필수이며 `null`일 수 없다/u)
  assert.match(apiProfile, /앞뒤 공백을 trim한 canonical 값만 저장한다/u)
  assert.match(
    apiProfile,
    /PATCH의 `defaultRegion`은 canonical 값, `null`, 또는 필드 생략만 허용한다/u,
  )
  assert.match(apiProfile, /기존 legacy 값은 GET에서 그대로 반환/u)
  assert.match(
    apiProfile,
    /`defaultRegion`을 생략한 unrelated PATCH는 기존 legacy 값을 그대로 보존/u,
  )
  assert.match(apiProfile, /`profiles\.default_region` 열은 nullable text로 유지/u)
  assert.match(apiProfile, /HTTP\/profile UI 경계에서만 시행/u)
  assert.match(apiProfile, /자동 마이그레이션이나 DB CHECK 제약을 추가하지 않는다/u)

  assert.match(onboarding, /`ProfileRegionPicker`에서 검색 후 canonical 지역을 명시적으로 선택/u)
  assert.match(onboarding, /입력한 free text 자체를 저장하거나 POST하지 않는다/u)

  assert.match(
    profileEdit,
    /기존 row의 지역이 `null`이거나 catalog에 없는 legacy 값이면 자동 수정하지 않고/u,
  )
  assert.match(profileEdit, /사용자가 canonical 지역을 명시적으로 다시 선택해야 저장할 수 있다/u)
}

async function readProfileSections() {
  const [apiDoc, screenDoc] = await Promise.all([
    readFile("SPOLINK_API_명세서.md", "utf8"),
    readFile("SPOLINK_화면_설계.md", "utf8"),
  ])

  return {
    apiProfile: sliceSection(apiDoc, "## 인증 / 프로필 API", "## 지도자 인증 API"),
    onboarding: sliceSection(screenDoc, "## 4. 온보딩 프로필", "## 5. 지도자 인증 신청"),
    profileEdit: sliceSection(screenDoc, "## 13. 마이페이지 프로필 수정", "## 14. 내 예약 목록"),
  }
}

test("profile documentation defines the canonical region boundary in its scoped sections", async () => {
  const sections = await readProfileSections()

  assertProfileDocumentationContract(sections)
})

test("profile documentation contract rejects alias and migration or DB CHECK claims in memory", async () => {
  const sections = await readProfileSections()
  const aliasFixture = {
    ...sections,
    apiProfile: sections.apiProfile.replaceAll("서울특별시 강남구", "서울 강남구"),
  }
  const migrationFixture = {
    ...sections,
    apiProfile: sections.apiProfile.replace(
      "자동 마이그레이션이나 DB CHECK 제약을 추가하지 않는다",
      "자동 마이그레이션과 DB CHECK 제약으로 강제한다",
    ),
  }

  assert.throws(() => assertProfileDocumentationContract(aliasFixture), /서울특별시 강남구/u)
  assert.throws(() => assertProfileDocumentationContract(migrationFixture), /자동 마이그레이션/u)
})
