import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

const workspaceRoot = path.resolve(process.env["SPOLINK_DOCUMENTATION_ROOT"] ?? process.cwd())

async function read(relativePath) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8")
}

function section(markdown, heading) {
  const lines = markdown.split("\n")
  const start = lines.indexOf(heading)
  assert.notEqual(start, -1, `missing heading: ${heading}`)
  const level = heading.match(/^#+/u)?.[0].length ?? 0
  const end = lines.findIndex(
    (line, index) => index > start && new RegExp(`^#{1,${level}}\\s`, "u").test(line),
  )
  return lines.slice(start, end === -1 ? lines.length : end).join("\n")
}

test("Given the owner review policy, when service and ERD contracts are parsed, then visibility matches both SELECT policies", async () => {
  const [servicePolicy, erd, lifecycleMigration, ownerMigration] = await Promise.all([
    read("SPOLINK_서비스_정책서.md"),
    read("SPOLINK_ERD.md"),
    read("supabase/migrations/20260814130000_add_review_lifecycle.sql"),
    read("supabase/migrations/20260831000000_add_owner_review_history_policy.sql"),
  ])
  const policySection = section(servicePolicy, "## 리뷰 정책")
  const rlsSection = section(erd, "## RLS 기준")

  assert.match(
    policySection,
    /작성자는 본인의 `visible`과 `hidden` 리뷰를 모두 조회하며, `hidden`의 숨김 사유는 작성자 본인에게만 표시한다\./u,
  )
  assert.match(policySection, /`deleted` 리뷰는 작성자를 포함한 일반 사용자에게 제공하지 않는다\./u)

  assert.match(
    lifecycleMigration,
    /create policy "reviews_public_visible_only" on public\.reviews\s+for select to anon, authenticated using \(status = 'visible'\);/iu,
  )
  assert.match(
    ownerMigration,
    /create policy "reviews_owner_visible_hidden_select" on public\.reviews\s+as permissive\s+for select\s+to authenticated\s+using \(\s*reviewer_id = \(select auth\.uid\(\)\)\s+and status in \('visible', 'hidden'\)\s*\);/iu,
  )
  assert.match(
    rlsSection,
    /\| `reviews_public_visible_only` \| `anon`, `authenticated` \| `status = 'visible'` \| 공개 목록은 공개 리뷰만 조회 \|/u,
  )
  assert.match(
    rlsSection,
    /\| `reviews_owner_visible_hidden_select` \| `authenticated` \| `reviewer_id = auth\.uid\(\)` AND `status IN \('visible', 'hidden'\)` \| 작성자 본인의 공개\/숨김 리뷰와 숨김 사유 조회 \|/u,
  )
  assert.match(rlsSection, /`deleted`는 두 SELECT 정책 모두 허용하지 않는다\./u)
})

test("Given the review read surfaces, when API documentation is parsed, then owner reads stay in the Server Component and public GET stays visible-only", async () => {
  const [api, pageSource, querySource, publicRoute, publicReadSource] = await Promise.all([
    read("SPOLINK_API_명세서.md"),
    read("app/mypage/reviews/page.tsx"),
    read("lib/reviews/read-query.ts"),
    read("app/api/lessons/[lessonId]/reviews/route.ts"),
    read("lib/lessons/display-lessons.ts"),
  ])
  const reviewApi = section(api, "## 리뷰 API")
  const ownerRead = section(reviewApi, "### 내 리뷰 관리 읽기")
  const publicRead = section(reviewApi, "### 레슨 리뷰 목록")

  assert.match(ownerRead, /HTTP `GET`을 추가하지 않는다/u)
  assert.match(ownerRead, /`\/mypage\/reviews` Server Component/u)
  assert.match(ownerRead, /세션의 `auth\.profile\.id`/u)
  assert.match(ownerRead, /`reviewer_id`가 일치하는 `visible`과 `hidden`만/u)
  assert.match(ownerRead, /`deleted`는 제외/u)
  assert.match(ownerRead, /숨김 사유는 작성자 전용/u)
  assert.doesNotMatch(reviewApi, /GET \/api\/reviews\/me/u)
  assert.equal(existsSync(path.join(workspaceRoot, "app/api/reviews/me/route.ts")), false)

  assert.match(pageSource, /readReviewHistoryData\(auth\.profile\.id, page\)/u)
  assert.match(querySource, /createSupabaseServerComponentClient/u)
  assert.match(querySource, /\.eq\("reviewer_id", learnerId\)/u)
  assert.match(querySource, /\.in\("status", \["visible", "hidden"\]\)/u)
  assert.match(publicRead, /`reviews\.status = visible`만 공개 노출한다\./u)
  assert.match(publicRoute, /buildLessonReviewsResponse\(lesson\)/u)
  assert.match(publicReadSource, /\.from\("reviews"\)[\s\S]*\.eq\("status", "visible"\)/u)
})

test("Given the implemented route, when the screen contract is parsed, then every state and navigation surface is documented", async () => {
  const [screen, page, loading, error, mypage, reviewForm, visualSummary] = await Promise.all([
    read("SPOLINK_화면_설계.md"),
    read("app/mypage/reviews/page.tsx"),
    read("app/mypage/reviews/loading.tsx"),
    read("app/mypage/reviews/error.tsx"),
    read("app/mypage/page.tsx"),
    read("components/reviews/review-form.tsx"),
    read(".omo/evidence/mypage-reviews-management/task-11/visual-summary.json"),
  ])
  const ownerScreen = section(screen, "## 16-1. 내 리뷰 관리")
  const verified = JSON.parse(visualSummary)

  assert.match(ownerScreen, /```text\s*\/mypage\/reviews\s*```/u)
  for (const state of ["ready", "empty", "out_of_range", "read_failure", "loading", "error"]) {
    assert.match(ownerScreen, new RegExp(`\\| ${state} \\|`, "u"))
  }
  assert.match(ownerScreen, /마이페이지의 `리뷰 내역 보기`/u)
  assert.match(ownerScreen, /리뷰 등록 성공 상태의 `내 리뷰 보기`/u)
  assert.match(ownerScreen, /390×844, 768×1024, 1280×800/u)
  assert.match(ownerScreen, /공개·숨김\/숨김 사유, 삭제 제외, 소유자 격리/u)

  for (const state of ["read_failure", "empty", "out_of_range", "ready"]) {
    assert.match(page, new RegExp(`reviewData\\.state === "${state}"`, "u"))
  }
  assert.match(loading, /aria-busy="true"/u)
  assert.match(error, /onClick=\{reset\}/u)
  assert.match(mypage, /href="\/mypage\/reviews"[\s\S]*리뷰 내역 보기/u)
  assert.match(reviewForm, /submitted \? <Link href="\/mypage\/reviews">내 리뷰 보기<\/Link>/u)
  assert.equal(verified.verdict, "APPROVE")
  assert.equal(verified.after.allTargetRectsAtLeast44, true)
  assert.equal(verified.after.noHorizontalOverflow, true)
})

test("Given Review Card guidance, when design and contributor contracts are parsed, then owner management reuses existing tokens and runners", async () => {
  const [design, globalCss, row, list, page, mypageGuide, e2eGuide] = await Promise.all([
    read("SPOLINK_디자인_시스템.md"),
    read("app/globals.css"),
    read("components/reviews/review-history-row.tsx"),
    read("components/reviews/review-history-list.tsx"),
    read("app/mypage/reviews/page.tsx"),
    read("app/mypage/AGENTS.md"),
    read("tests/auth-ui-e2e/AGENTS.md"),
  ])
  const reviewCard = section(design, "### 5.15 Review Card")
  const implementation = `${row}\n${list}\n${page}`

  assert.match(reviewCard, /Owner management variant/u)
  assert.match(reviewCard, /공개 상태, 별점, 작성일, 레슨명, 본문/u)
  assert.match(reviewCard, /`hidden`에서만 작성자 전용 숨김 사유/u)
  assert.match(reviewCard, /레슨 링크와 페이지 이동 컨트롤은 최소 44px/u)
  assert.match(reviewCard, /새 토큰을 추가하지 않고 기존 semantic token/u)
  assert.doesNotMatch(globalCss, /--review-/u)
  assert.match(implementation, /min-h-11/u)
  assert.doesNotMatch(implementation, /#[0-9a-f]{3,8}\b/iu)

  assert.match(mypageGuide, /`\/mypage\/reviews`/u)
  assert.match(mypageGuide, /`ready`, `empty`, `out_of_range`, `read_failure`, `loading`, `error`/u)
  assert.match(
    e2eGuide,
    /node tests\/auth-ui-e2e\/run-mypage-reviews\.mjs \.omo\/evidence\/mypage-reviews-management\/task-8\/focused-summary\.json/u,
  )
  assert.match(e2eGuide, /owner visible\/hidden, deleted exclusion, public visible-only/u)
})

test("Given Todo 8 documentation, when scope claims are inspected, then verification remains local-only", async () => {
  const [api, screen, mypageGuide, e2eGuide] = await Promise.all([
    read("SPOLINK_API_명세서.md"),
    read("SPOLINK_화면_설계.md"),
    read("app/mypage/AGENTS.md"),
    read("tests/auth-ui-e2e/AGENTS.md"),
  ])
  const ownerRead = section(section(api, "## 리뷰 API"), "### 내 리뷰 관리 읽기")
  const ownerScreen = section(screen, "## 16-1. 내 리뷰 관리")
  const scopedText = `${ownerRead}\n${ownerScreen}\n${mypageGuide}\n${e2eGuide}`

  assert.match(ownerRead, /로컬 Supabase\/Next 검증 범위/u)
  assert.match(ownerScreen, /검증 근거는 로컬 managed Supabase\/Next\/Chromium 실행/u)
  assert.doesNotMatch(
    scopedText,
    /hosted[^\n]*(?:검증|완료|통과)|production[^\n]*(?:검증|완료|통과)|provider[^\n]*(?:검증|완료|통과)/iu,
  )
})
