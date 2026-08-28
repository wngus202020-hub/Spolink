import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import typescript from "typescript"

const projectRootUrl = pathToFileURL(`${process.cwd()}/`)
const runtimeKey = Symbol.for("spolink.coach-navigation.runtime")
const runtime = { auth: { kind: "unauthenticated" }, createElement }

globalThis[runtimeKey] = runtime

const stubSources = new Map([
  [
    "next/link",
    `const runtime = globalThis[Symbol.for("spolink.coach-navigation.runtime")]
export default function Link({ children, href, ...props }) {
  return runtime.createElement("a", { ...props, href }, children)
}`,
  ],
  [
    "next/navigation",
    `export function redirect(path) {
  const error = new Error(path)
  error.code = "SPOLINK_TEST_REDIRECT"
  error.path = path
  throw error
}`,
  ],
  [
    "@/lib/auth/page-auth",
    `const runtime = globalThis[Symbol.for("spolink.coach-navigation.runtime")]
export async function readPageAuthProfile() { return runtime.auth }`,
  ],
])

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".ts") || url.endsWith(".tsx")) {
      const fileName = fileURLToPath(url)
      const result = typescript.transpileModule(readFileSync(fileName, "utf8"), {
        compilerOptions: {
          jsx: typescript.JsxEmit.ReactJSX,
          module: typescript.ModuleKind.ESNext,
          target: typescript.ScriptTarget.ES2022,
        },
        fileName,
      })
      return { format: "module", shortCircuit: true, source: result.outputText }
    }
    return nextLoad(url, context)
  },
  resolve(specifier, context, nextResolve) {
    const stubSource = stubSources.get(specifier)
    if (stubSource) {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(stubSource)}` }
    }

    const baseUrl = specifier.startsWith("@/")
      ? new URL(specifier.slice(2), projectRootUrl)
      : context.parentURL && specifier.startsWith(".")
        ? new URL(specifier, context.parentURL)
        : null
    if (baseUrl) {
      for (const extension of [".ts", ".tsx"]) {
        const candidate = new URL(`${baseUrl.href}${extension}`)
        if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

const { PublicHeader } = await import("../components/layout/public-header.tsx")
const { default: MyPage } = await import("../app/mypage/page.tsx")

const readyCases = [
  ["learner", readyAuth("learner", "active", null), "application"],
  ["role-only", readyAuth("coach", "active", null), "application"],
  ["draft", readyAuth("learner", "pending_coach", "draft"), "application"],
  ["submitted", readyAuth("learner", "pending_coach", "submitted"), "status"],
  ["rejected", readyAuth("learner", "pending_coach", "rejected"), "status"],
  ["suspended", readyAuth("coach", "coach_approved", "suspended"), "status"],
  ["profile-coach-mismatch", readyAuth("coach", "active", "approved"), "status"],
  ["approved", readyAuth("coach", "coach_approved", "approved"), "center"],
  ["admin", readyAuth("admin", "active", null), "application"],
  ["undefined-coach-profile", readyAuth("coach", "coach_approved", undefined), "status"],
]

const navigationEntries = {
  application: {
    action: "등록 안내",
    ariaLabel: "지도자 등록 안내로 이동",
    cardLabel: "지도자 등록",
    description: "자격과 경력을 인증하고 지도자 활동을 준비해요.",
    headerLabel: "지도자 등록",
    href: "/coach/apply",
  },
  center: {
    action: "센터 열기",
    ariaLabel: "지도자 센터로 이동",
    cardLabel: "지도자 센터",
    description: "오늘 일정, 예약과 정산 운영을 관리해요.",
    headerLabel: "지도자 센터",
    href: "/coach/dashboard",
  },
  status: {
    action: "상태 확인",
    ariaLabel: "지도자 등록 상태로 이동",
    cardLabel: "지도자 등록 상태",
    description: "신청 및 심사 상태를 확인하고 필요한 다음 단계를 진행해요.",
    headerLabel: "등록 상태",
    href: "/coach/apply/status",
  },
}

test("PublicHeader and MyPage navigation matrix", async (t) => {
  const publicStates = [
    ["unauthenticated", { kind: "unauthenticated" }, "application"],
    ["profile-required", { kind: "profile_required", userId: "redacted" }, "application"],
    ...readyCases,
  ]

  for (const [name, auth, entryKind] of publicStates) {
    await t.test(`header-${name}`, () => {
      const html = renderHeader(auth)
      const entry = navigationEntries[entryKind]
      assert.equal(countLink(html, "/lessons", "레슨"), 1)
      assert.equal(countLink(html, entry.href, entry.headerLabel), 1)
      assert.equal(coachNavigationLinks(html).length, 1)

      if (auth.kind === "unauthenticated") assert.equal(countLink(html, "/auth/login", "로그인"), 1)
      if (auth.kind === "profile_required") {
        assert.equal(countLink(html, "/onboarding/profile", "프로필 설정"), 1)
      }
      if (auth.kind === "ready") {
        assert.equal(countLink(html, "/mypage", "마이"), 1)
        assert.match(html, /action="\/auth\/logout" method="post"/u)
        assert.equal(countLink(html, "/admin", "관리자"), name === "admin" ? 1 : 0)
      }
    })
  }

  for (const [name, auth, entryKind] of readyCases) {
    await t.test(`mypage-${name}`, async () => {
      const html = await renderMyPage(auth)
      const entry = navigationEntries[entryKind]
      assert.equal(countHref(html, entry.href), 2)
      assert.equal(coachNavigationLinks(html).length, 2)
      assert.match(html, new RegExp(`aria-label="${entry.ariaLabel}"`, "u"))
      assert.ok(html.includes(entry.cardLabel))
      assert.ok(html.includes(entry.description))
      assert.ok(html.includes(entry.action))
      assert.equal(countLink(html, "/mypage", "마이"), 1)
      assert.equal(countLink(html, "/admin", "관리자"), name === "admin" ? 1 : 0)
    })
  }

  await assertRedirect({ kind: "unauthenticated" }, "/auth/login?next=/mypage")
  await assertRedirect({ kind: "profile_required", userId: "redacted" }, "/onboarding/profile")
})

test("approved coach navigation HTML", async () => {
  const approvedAuth = readyCases.find(([name]) => name === "approved")?.[1]
  assert.ok(approvedAuth)
  const approvedHeader = renderHeader(approvedAuth)
  const approvedMyPage = await renderMyPage(approvedAuth)

  assert.deepEqual(
    {
      headerApply: countHref(approvedHeader, "/coach/apply"),
      headerCenter: countLink(approvedHeader, "/coach/dashboard", "지도자 센터"),
      myPageApply: countHref(approvedMyPage, "/coach/apply"),
      myPageCenter: countHref(approvedMyPage, "/coach/dashboard"),
    },
    { headerApply: 0, headerCenter: 1, myPageApply: 0, myPageCenter: 2 },
  )

  for (const name of ["submitted", "profile-coach-mismatch"]) {
    const auth = readyCases.find(([caseName]) => caseName === name)?.[1]
    assert.ok(auth)
    const header = renderHeader(auth)
    const myPage = await renderMyPage(auth)
    assert.equal(countHref(header, "/coach/dashboard"), 0)
    assert.equal(countHref(myPage, "/coach/dashboard"), 0)
    assert.equal(countHref(header, "/coach/apply/status"), 1)
    assert.equal(countHref(myPage, "/coach/apply/status"), 2)
  }

  console.log(
    `APPROVED_COACH_NAVIGATION_HTML ${JSON.stringify({
      approvedHeaderSha256: sha256(approvedHeader),
      approvedMyPageSha256: sha256(approvedMyPage),
      headerScenarioCount: readyCases.length + 2,
      myPageScenarioCount: readyCases.length + 2,
    })}`,
  )
})

test("header and mypage share one server-derived coach navigation policy", () => {
  const header = readFileSync("components/layout/public-header.tsx", "utf8")
  const myPage = readFileSync("app/mypage/page.tsx", "utf8")
  const policy = readFileSync("lib/auth/coach-navigation.ts", "utf8")

  for (const consumer of [header, myPage]) {
    assert.match(consumer, /getCoachNavigationEntry\(auth\)/u)
    assert.doesNotMatch(consumer, /coach_approved|coachProfile\?\.status/u)
  }
  assert.match(policy, /auth\.profile\.status === "coach_approved"/u)
  assert.match(policy, /coachStatus === "approved"/u)
})

async function assertRedirect(auth, path) {
  runtime.auth = auth
  await assert.rejects(
    MyPage(),
    (error) => error?.code === "SPOLINK_TEST_REDIRECT" && error.path === path,
  )
}

function countLink(html, href, label) {
  return readLinks(html).filter((link) => link.href === href && link.label === label).length
}

function countHref(html, href) {
  return readLinks(html).filter((link) => link.href === href).length
}

function coachNavigationLinks(html) {
  return readLinks(html).filter(
    (link) => link.href.startsWith("/coach/apply") || link.href === "/coach/dashboard",
  )
}

function readLinks(html) {
  return [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gu)].map(
    ([, href, contents]) => ({ href, label: contents.replace(/<[^>]+>/gu, "").trim() }),
  )
}

function readyAuth(role, status, coachStatus) {
  return {
    coachProfile:
      coachStatus === null ? null : coachStatus === undefined ? undefined : { status: coachStatus },
    kind: "ready",
    profile: {
      default_region: "서울특별시 강남구",
      display_name: "표시 이름",
      role,
      status,
    },
  }
}

function renderHeader(auth) {
  return renderToStaticMarkup(createElement(PublicHeader, { auth }))
}

async function renderMyPage(auth) {
  runtime.auth = auth
  return renderToStaticMarkup(await MyPage())
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
