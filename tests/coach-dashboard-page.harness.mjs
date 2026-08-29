import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import typescript from "typescript"

const projectRootUrl = pathToFileURL(`${process.cwd()}/`)
const runtimeKey = Symbol.for("spolink.coach-dashboard-page-runtime")

export const runtime = {
  calls: [],
  createElement,
  dashboard: null,
  focusCount: 0,
  routes: [],
  search: "uiState=error",
}

globalThis[runtimeKey] = runtime

const stubSources = new Map([
  [
    "next/link",
    `const runtime = globalThis[Symbol.for("spolink.coach-dashboard-page-runtime")]
export default function Link({ children, href, ...props }) {
  return runtime.createElement("a", { ...props, href }, children)
}`,
  ],
  ["@/components/layout/public-header", "export function PublicHeader() { return null }"],
  [
    "next/navigation",
    `const runtime = globalThis[Symbol.for("spolink.coach-dashboard-page-runtime")]
export function usePathname() { return "/coach/dashboard" }
export function useSearchParams() { return new URLSearchParams(runtime.search) }`,
  ],
  [
    "@/lib/lessons/coach-authoring-page",
    `const runtime = globalThis[Symbol.for("spolink.coach-dashboard-page-runtime")]
export async function readApprovedCoachPage(path) {
  runtime.calls.push(["auth", path])
  return {
    auth: { coachProfile: { id: "coach-owned" }, kind: "ready", profile: { id: "profile-owned" } },
    supabase: { kind: "rls-aware-client" },
  }
}`,
  ],
  [
    "@/lib/coach/dashboard-read-model",
    `const runtime = globalThis[Symbol.for("spolink.coach-dashboard-page-runtime")]
export async function readCoachDashboard(input) {
  runtime.calls.push(["read-model", input.coachProfileId, input.profileId, input.client.kind])
  return runtime.dashboard
}`,
  ],
])

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".ts") || url.endsWith(".tsx")) {
      const fileName = fileURLToPath(url)
      const fileSource = readFileSync(fileName, "utf8")
      const source =
        url.endsWith("/app/coach/dashboard/error.tsx") ||
        url.endsWith("/app/coach/dashboard/coach-dashboard-recovery-view.tsx")
          ? fileSource.replace(
              'import { useEffect, useRef } from "react"',
              `const runtime = globalThis[Symbol.for("spolink.coach-dashboard-page-runtime")]
const useEffect = (effect) => effect()
const useRef = () => ({ current: { focus() { runtime.focusCount += 1 } } })`,
            )
          : fileSource
      const result = typescript.transpileModule(source, {
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

export const populatedDashboard = Object.freeze({
  notifications: Object.freeze({
    items: Object.freeze([
      Object.freeze({
        body: "예약 일정이 변경되었습니다.",
        createdAt: "2026-08-29T03:30:00.000Z",
        rawPayload: "private-notification-payload",
        title: "일정 변경 알림",
      }),
    ]),
    unreadCount: 4,
  }),
  pendingSettlements: Object.freeze({ count: 2, totalNetAmount: 33000 }),
  recentReviews: Object.freeze([
    Object.freeze({
      author: "reviewer-private-name",
      content: "설명이 친절하고 수업 흐름이 좋았어요.",
      createdAt: "2026-08-28T23:00:00.000Z",
      lessonTitle: "테니스 입문 집중 클래스",
      rating: 5,
    }),
  ]),
  reservations: Object.freeze({
    completionPending: 3,
    confirmed: 3,
    labels: Object.freeze({ confirmed: "예약 확정", pending_payment: "결제 대기" }),
    pendingPayment: 2,
  }),
  todaySchedules: Object.freeze([
    Object.freeze({
      capacity: 6,
      endsAt: "2026-08-29T05:00:00.000Z",
      isOpen: true,
      lessonTitle: "주말 아침 테니스 초급자 기본기 집중 클래스",
      reservedCount: 4,
      startsAt: "2026-08-29T03:00:00.000Z",
    }),
    Object.freeze({
      capacity: 4,
      endsAt: "2026-08-29T08:00:00.000Z",
      isOpen: false,
      lessonTitle: "러닝 자세 교정",
      reservedCount: 4,
      startsAt: "2026-08-29T07:00:00.000Z",
    }),
  ]),
})

export const emptyDashboard = Object.freeze({
  notifications: Object.freeze({ items: Object.freeze([]), unreadCount: 0 }),
  pendingSettlements: Object.freeze({ count: 0, totalNetAmount: 0 }),
  recentReviews: Object.freeze([]),
  reservations: Object.freeze({
    completionPending: 0,
    confirmed: 0,
    labels: Object.freeze({ confirmed: "예약 확정", pending_payment: "결제 대기" }),
    pendingPayment: 0,
  }),
  todaySchedules: Object.freeze([]),
})

export async function loadRequiredModule(path) {
  assert.equal(existsSync(path), true, `RED: ${path} is not implemented`)
  return import(`../${path}`)
}

export function resetRuntime(dashboard) {
  runtime.calls = []
  runtime.dashboard = dashboard
}

export function setFixtureEnvironment(value) {
  if (value === undefined) delete process.env["SPOLINK_COACH_DASHBOARD_UI_FIXTURES"]
  else process.env["SPOLINK_COACH_DASHBOARD_UI_FIXTURES"] = value
}

export function readHrefs(html) {
  return [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>/gu)].map((match) => match[1])
}

export function readHeadings(html) {
  return [...html.matchAll(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gu)].map((match) =>
    match[1].replace(/<[^>]+>/gu, ""),
  )
}

export function findClickableElement(node) {
  if (!node || typeof node !== "object") return null
  if (typeof node.props?.onClick === "function") return node
  const children = Array.isArray(node.props?.children)
    ? node.props.children
    : [node.props?.children]
  for (const child of children) {
    const found = findClickableElement(child)
    if (found) return found
  }
  return null
}

export { createElement, renderToStaticMarkup }
