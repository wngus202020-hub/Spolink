import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createElement } from "react"
import typescript from "typescript"

import { inspectRenderedHtml } from "./react-html-runtime.mjs"

const workspaceUrl = pathToFileURL(`${process.cwd()}/`).href
const runtimeKey = Symbol.for("spolink.mypage-reviews-ui-runtime")
const readyAuth = { kind: "ready", profile: { id: "learner-ui-contract" } }

class RouteSignal extends Error {
  constructor(destination) {
    super(destination)
    this.destination = destination
  }
}

const runtime = {
  auth: readyAuth,
  calls: [],
  createElement,
  data: null,
  readAuth: async () => runtime.auth,
  readReviewHistory: async (...args) => {
    runtime.calls.push(args)
    return runtime.data
  },
  redirect(destination) {
    throw new RouteSignal(destination)
  },
}

globalThis[runtimeKey] = runtime

const stubSources = new Map([
  [
    "next/link",
    'const runtime = globalThis[Symbol.for("spolink.mypage-reviews-ui-runtime")]; export default function Link({ children, href, ...props }) { return runtime.createElement("a", { ...props, href }, children) }',
  ],
  [
    "next/navigation",
    'const runtime = globalThis[Symbol.for("spolink.mypage-reviews-ui-runtime")]; export const redirect = (destination) => runtime.redirect(destination)',
  ],
  ["@/components/layout/public-header", "export function PublicHeader() { return null }"],
  [
    "@/components/ui/status-badge",
    'const runtime = globalThis[Symbol.for("spolink.mypage-reviews-ui-runtime")]; export function StatusBadge({ children, tone }) { return runtime.createElement("span", { "data-tone": tone }, children) }',
  ],
  [
    "@/lib/auth/page-auth",
    'const runtime = globalThis[Symbol.for("spolink.mypage-reviews-ui-runtime")]; export const readPageAuthProfile = () => runtime.readAuth()',
  ],
  [
    "@/lib/reviews/read-model",
    'const runtime = globalThis[Symbol.for("spolink.mypage-reviews-ui-runtime")]; export const normalizeReviewHistoryPage = (value) => typeof value === "string" && /^\\d+$/u.test(value) && Number(value) > 0 ? Number(value) : 1; export const readReviewHistoryData = (...args) => runtime.readReviewHistory(...args)',
  ],
])

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".ts") || url.endsWith(".tsx")) {
      const result = typescript.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: {
          jsx: typescript.JsxEmit.ReactJSX,
          module: typescript.ModuleKind.ESNext,
          target: typescript.ScriptTarget.ES2022,
        },
        fileName: fileURLToPath(url),
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
      ? new URL(specifier.slice(2), workspaceUrl)
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

function configureRuntime({ auth = readyAuth, data = null } = {}) {
  runtime.auth = auth
  runtime.calls = []
  runtime.data = data
}

async function captureRouteSignal(action) {
  try {
    await action()
  } catch (error) {
    if (error instanceof RouteSignal) return error.destination
    throw error
  }
  return null
}

async function loadReviewsPage() {
  return await import("../app/mypage/reviews/page.tsx")
}

async function loadReviewComponents() {
  const [list, row] = await Promise.all([
    import("../components/reviews/review-history-list.tsx"),
    import("../components/reviews/review-history-row.tsx"),
  ])
  return { ...list, ...row }
}

const readyViewModel = {
  items: [
    {
      content: "작성한 내용이 없습니다.",
      createdAtText: "2026. 8. 31.",
      hiddenReason: null,
      key: "visible-review",
      lessonHref: "/lessons/active-lesson",
      lessonTitle: "긴 제목도 작은 화면에서 자연스럽게 줄바꿈되는 테니스 기초 레슨입니다",
      rating: 5,
      ratingLabel: "5점 만점에 5점",
      status: { label: "공개 중", tone: "success" },
    },
    {
      content: "운영 정책 검토를 위해 숨김 처리된 후기입니다.",
      createdAtText: "2026. 8. 30.",
      hiddenReason:
        "개인정보로 해석될 수 있는 긴 한국어 사유가 포함되어 운영 정책에 따라 숨김 처리되었습니다.",
      key: "hidden-review",
      lessonHref: null,
      lessonTitle: "현재 공개되지 않는 레슨",
      rating: 1,
      ratingLabel: "5점 만점에 1점",
      status: { label: "숨김", tone: "warning" },
    },
  ],
  page: 2,
  totalCount: 21,
  totalPages: 2,
}

test("Given unavailable account states, when the review page loads, then it redirects before the owner read", async (t) => {
  // Given: each protected route state without a ready profile.
  const Page = (await loadReviewsPage()).default

  // When: the page is requested with every unavailable state.
  for (const [auth, destination] of [
    [{ kind: "unauthenticated" }, "/auth/login?next=/mypage/reviews"],
    [{ kind: "unconfigured" }, "/auth/login?next=/mypage/reviews"],
    [{ kind: "profile_required" }, "/onboarding/profile"],
  ]) {
    await t.test(auth.kind, async () => {
      configureRuntime({ auth, data: { state: "read_failure", viewModel: null } })
      assert.equal(
        await captureRouteSignal(() => Page({ searchParams: Promise.resolve({}) })),
        destination,
      )
      assert.deepEqual(runtime.calls, [])
    })
  }
})

test("Given a ready account and malformed query array, when the review page renders, then it reads only the owner at page one", async () => {
  // Given: a ready member and a malformed page array.
  const pageModule = await loadReviewsPage()
  configureRuntime({
    data: { state: "empty", viewModel: { items: [], page: 1, totalCount: 0, totalPages: 1 } },
  })

  // When: the server page composes the review history.
  const element = await pageModule.default({ searchParams: Promise.resolve({ page: ["2", "3"] }) })

  // Then: the route remains fresh, owner-scoped, and exposes the empty reservations CTA.
  assert.equal(pageModule.dynamic, "force-dynamic")
  assert.equal(pageModule.revalidate, 0)
  assert.deepEqual(runtime.calls, [["learner-ui-contract", 1]])
  await inspectRenderedHtml(element, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    assert.deepEqual(await page.getByRole("heading", { level: 1 }).allTextContents(), ["내 리뷰"])
    assert.equal(await page.locator("main").count(), 1)
    assert.equal(
      await page.getByRole("link", { name: "예약 내역 보기" }).getAttribute("href"),
      "/mypage/reservations",
    )
    await assertNoHorizontalOverflow(page)
  })
})

test("Given the reviews page, when the back link is styled, then it uses the 44px target token", () => {
  // Given: the actual route source whose min-h-10 token produced a computed 40px target.
  const source = readFileSync(new URL("../app/mypage/reviews/page.tsx", import.meta.url), "utf8")

  // When: the exact back-link class contract is extracted.
  const match = source.match(/<Link\s+className="([^"]+)"\s+href="\/mypage"/u)

  // Then: the existing 44px minimum-height token is required, not the 40px token.
  assert.notEqual(match, null)
  const classes = match[1].split(/\s+/u)
  assert.ok(classes.includes("min-h-11"), `expected min-h-11, received ${match[1]}`)
  assert.equal(classes.includes("min-h-10"), false)
})

test("Given ready review data, when the reusable list renders at 390px, then rows expose safe history semantics without overflow", async () => {
  // Given: visible, hidden, nullable, and unavailable historical review projections.
  const { ReviewHistoryList } = await loadReviewComponents()

  // When: the reusable list is rendered inside real Chromium at mobile width.
  await inspectRenderedHtml(
    createElement(ReviewHistoryList, { viewModel: readyViewModel }),
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })

      // Then: headings, status, rating, dates, conditional links, and hidden-reason scope are observable.
      assert.equal(await page.getByRole("heading", { level: 2, name: "리뷰 내역" }).count(), 1)
      assert.equal(await page.getByText("총 21건").count(), 1)
      assert.equal(await page.getByText("2 / 2 페이지").count(), 1)
      assert.equal(await page.getByLabel("5점 만점에 5점").count(), 1)
      assert.equal(await page.getByLabel("5점 만점에 1점").count(), 1)
      assert.equal(await page.locator("time").count(), 2)
      assert.equal(await page.getByText("작성한 내용이 없습니다.").count(), 1)
      assert.equal(await page.getByText("숨김 사유").count(), 1)
      assert.equal(await page.locator("a[href='/lessons/active-lesson']").count(), 1)
      assert.equal(await page.locator("a[href*='unavailable'], a[href*='undefined']").count(), 0)
      assert.equal(
        await page
          .locator("[id]")
          .evaluateAll((nodes) => new Set(nodes.map((node) => node.id)).size),
        await page.locator("[id]").count(),
      )
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
        true,
      )
    },
  )
})

test("Given out-of-range and read failures, when the page renders, then recovery states remain distinct and private", async () => {
  // Given: separate expected owner-read outcomes.
  const Page = (await loadReviewsPage()).default
  configureRuntime({
    data: {
      state: "out_of_range",
      viewModel: { items: [], page: 9, totalCount: 21, totalPages: 2 },
    },
  })

  // When: the requested page exceeds the available result range.
  const outOfRange = await Page({ searchParams: Promise.resolve({ page: "9" }) })

  // Then: only the first-page recovery CTA is exposed.
  await inspectRenderedHtml(outOfRange, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(
      await page.getByRole("link", { name: "첫 페이지 보기" }).getAttribute("href"),
      "/mypage/reviews",
    )
    assert.equal(await page.getByRole("alert").count(), 0)
    await assertNoHorizontalOverflow(page)
  })

  configureRuntime({ data: { state: "read_failure", viewModel: null } })
  const failure = await Page({ searchParams: Promise.resolve({}) })
  await inspectRenderedHtml(failure, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await page.getByRole("alert").count(), 1)
    assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1)
    assert.equal(await page.locator("a[href*='/lessons/']").count(), 0)
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /visible-review|hidden-review|learner-ui-contract/u,
    )
    await assertNoHorizontalOverflow(page)
  })
})

test("Given local loading and unexpected error boundaries, when keyboard users inspect them, then busy and reset controls are available", async () => {
  // Given: route-local loading and error modules.
  const [loadingModule, errorModule] = await Promise.all([
    import("../app/mypage/reviews/loading.tsx"),
    import("../app/mypage/reviews/error.tsx"),
  ])
  let resets = 0
  const errorElement = errorModule.default({
    reset: () => {
      resets += 1
    },
  })

  // When: their actual output is inspected in Chromium and reset is invoked through its button prop.
  await inspectRenderedHtml(createElement(loadingModule.default), async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await page.locator("main[aria-busy='true']").count(), 1)
    assert.deepEqual(await page.getByRole("heading", { level: 1 }).allTextContents(), ["내 리뷰"])
    assert.equal((await page.locator("[class*='animate-pulse']").count()) >= 2, true)
    await assertNoHorizontalOverflow(page)
  })
  await inspectRenderedHtml(errorElement, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const button = page.getByRole("button", { name: "다시 시도" })
    await button.focus()
    assert.equal(await button.evaluate((node) => document.activeElement === node), true)
    assert.equal(await page.getByRole("alert").count(), 1)
    assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1)
    await assertNoHorizontalOverflow(page)
  })
  const resetButton = findElementByType(errorElement, "button")
  assert.notEqual(resetButton, null)
  resetButton.props.onClick()

  // Then: no error detail leaks and the supplied reset callback remains wired.
  assert.equal(resets, 1)
})

function findElementByType(element, type) {
  if (!element || typeof element !== "object") return null
  if (element?.type === type) return element
  const children = element?.props?.children
  const values = Array.isArray(children) ? children : [children]
  for (const child of values) {
    const found = findElementByType(child, type)
    if (found) return found
  }
  return null
}

async function assertNoHorizontalOverflow(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
    true,
  )
}
