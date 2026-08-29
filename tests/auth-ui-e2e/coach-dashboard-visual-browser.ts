import path from "node:path"

import { expect, type Page } from "@playwright/test"

import {
  contrastRatio,
  detectGeometryIssues,
  parseRgbColor,
} from "./coach-dashboard-visual-contract.mjs"

type VisualCaptureInput = Readonly<{
  focusRequired?: boolean
  onFailure: (issue: string) => void
  name: string
  page: Page
  runtimeErrorsBefore: number
  runtimeErrors: readonly string[]
  visualDir: string
}>

export async function captureCoachDashboardVisual(input: VisualCaptureInput) {
  const viewport = input.page.viewportSize()
  if (!viewport) throw new Error("Visual scenario requires a fixed viewport")
  const geometry = await readGeometry(input.page, input.focusRequired === true)
  const issues = detectGeometryIssues(geometry)
  const firstIssue = issues[0]
  if (firstIssue) input.onFailure(firstIssue)
  expect(issues).toEqual([])
  const runtimeErrors = input.runtimeErrors.length - input.runtimeErrorsBefore
  await input.page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: path.join(input.visualDir, input.name),
    scale: "css",
  })
  if (runtimeErrors > 0) {
    input.onFailure(
      `runtime-${classifyRuntimeErrors(input.runtimeErrors.slice(input.runtimeErrorsBefore))}`,
    )
  }
  expect(runtimeErrors).toBe(0)
  return {
    cjkOrphans: geometry.cjkOrphans,
    clippedElements: 0,
    documentWidth: geometry.documentWidth,
    focused: geometry.focused,
    height: viewport.height,
    issueIndicators: geometry.issueIndicators,
    overlaps: 0,
    replacementGlyphs: geometry.replacementGlyphs,
    runtimeErrors,
    stableGroups: geometry.stableGroups.length,
    width: viewport.width,
  }
}

export async function assertRenderedDarkContrast(page: Page) {
  const rendered = await page.evaluate(() => {
    const primary = document.querySelector("h1")
    const secondary = document.querySelector("main p")
    if (!(primary instanceof HTMLElement) || !(secondary instanceof HTMLElement)) {
      throw new Error("Dark contrast probes are missing")
    }
    return {
      background: effectiveBackground(primary),
      primary: getComputedStyle(primary).color,
      secondary: getComputedStyle(secondary).color,
    }

    function effectiveBackground(element: HTMLElement) {
      let current: HTMLElement | null = element
      while (current) {
        const color = getComputedStyle(current).backgroundColor
        if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") return color
        current = current.parentElement
      }
      return getComputedStyle(document.documentElement).backgroundColor
    }
  })
  const background = parseRgbColor(rendered.background)
  const primaryRatio = contrastRatio(parseRgbColor(rendered.primary), background)
  const secondaryRatio = contrastRatio(parseRgbColor(rendered.secondary), background)
  expect(primaryRatio).toBeGreaterThanOrEqual(4.5)
  expect(secondaryRatio).toBeGreaterThanOrEqual(4.5)
  return {
    primaryRatio: round(primaryRatio),
    secondaryRatio: round(secondaryRatio),
  }
}

async function readGeometry(page: Page, focusRequired: boolean) {
  return page.evaluate((requiresFocus) => {
    const viewportWidth = document.documentElement.clientWidth
    const boxes: Array<{
      clientHeight: number
      clientWidth: number
      height: number
      name: string
      parent: string
      scrollHeight: number
      scrollWidth: number
      width: number
      x: number
      y: number
    }> = []
    const stableGroups: Array<{ heights: number[]; name: string; widths: number[] }> = []
    const addBox = (element: Element, name: string, parent: string) => {
      if (!(element instanceof HTMLElement)) return
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      boxes.push({
        clientHeight: element.clientHeight,
        clientWidth: element.clientWidth,
        height: rect.height,
        name,
        parent,
        scrollHeight: element.scrollHeight,
        scrollWidth: element.scrollWidth,
        width: rect.width,
        x: rect.x,
        y: rect.y,
      })
    }
    const addSiblingGroup = (elements: readonly Element[], name: string, stable = false) => {
      const heights: number[] = []
      const widths: number[] = []
      elements.forEach((element, index) => {
        addBox(element, `${name}-${index}`, name)
        const rect = element.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          heights.push(rect.height)
          widths.push(rect.width)
        }
      })
      if (stable && elements.length > 1) stableGroups.push({ heights, name, widths })
    }

    addSiblingGroup([...document.querySelectorAll("main > *")], "main-landmarks")
    document.querySelectorAll("ol, ul").forEach((list, index) => {
      addSiblingGroup([...list.children], `list-${index}`)
    })
    addSiblingGroup(
      [...document.querySelectorAll("#dashboard-summary-heading + ul > li")],
      "summary-metrics",
      true,
    )
    const quickActions = [
      "/coach/lessons/new",
      "/coach/lessons",
      "/coach/reservations",
      "/coach/settlements",
    ]
      .map((href) => document.querySelector(`a[href="${href}"]`))
      .filter((element): element is Element => element !== null)
    if (quickActions.length === 4) addSiblingGroup(quickActions, "quick-actions", true)

    const clippingSelector = "h1,h2,h3,p,a,button,strong,span,time,[role=status],[role=alert]"
    document.querySelectorAll(clippingSelector).forEach((element, index) => {
      addBox(element, `content-${index}`, `content-${index}`)
    })
    const bodyText = document.body.innerText
    const cjkOrphans =
      viewportWidth <= 390
        ? longestKoreanLabels().reduce(
            (count, label) => count + countSingleSyllableLines(findExactText(label)),
            0,
          )
        : 0
    const focused = !requiresFocus || document.activeElement === document.querySelector("h1")
    const issueIndicators = [...document.querySelectorAll("nextjs-portal")].filter((portal) => {
      const elements = portal.shadowRoot?.querySelectorAll("*") ?? []
      return [...elements].some((element) => {
        if (!(element instanceof HTMLElement)) return false
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          /\b[1-9]\d*\s+Issues?\b/iu.test(element.innerText)
        )
      })
    }).length
    return {
      boxes,
      cjkOrphans,
      documentWidth: document.documentElement.scrollWidth,
      focusRequired: requiresFocus,
      focused,
      issueIndicators,
      replacementGlyphs: (bodyText.match(/\uFFFD/gu) ?? []).length,
      stableGroups,
      viewportWidth,
    }

    function longestKoreanLabels() {
      return [
        "오늘의 레슨과 처리할 예약, 정산 현황을 한곳에서 확인하세요.",
        "지도자 운영 현황을 불러오는 중입니다.",
        "지도자 운영 현황을 불러오지 못했어요",
        "잠시 후 다시 시도해 주세요. 문제가 계속되면 고객센터에 문의해 주세요.",
        "완료 처리 대기 확인",
      ]
    }

    function findExactText(text: string) {
      return [...document.querySelectorAll("h1,p,a")].find(
        (element) => element.textContent?.trim() === text,
      )
    }

    function countSingleSyllableLines(element: Element | undefined) {
      if (!element?.firstChild || element.firstChild.nodeType !== Node.TEXT_NODE) return 0
      const text = element.textContent ?? ""
      const lines = new Map<number, string>()
      for (let index = 0; index < text.length; index += 1) {
        const range = document.createRange()
        range.setStart(element.firstChild, index)
        range.setEnd(element.firstChild, index + 1)
        const rect = range.getBoundingClientRect()
        const key = Math.round(rect.top)
        lines.set(key, `${lines.get(key) ?? ""}${text[index] ?? ""}`)
      }
      return [...lines.values()].filter((line) => /^[가-힣]$/u.test(line.trim())).length
    }
  }, focusRequired)
}

function round(value: number) {
  return Math.round(value * 1_000) / 1_000
}

function classifyRuntimeErrors(errors: readonly string[]) {
  const value = errors.join(" ").toLowerCase()
  if (value.includes("deterministic coach dashboard error fixture")) return "fixture-error"
  if (value.includes("coachdashboardfixtureerror")) return "fixture-error"
  if (value.includes("failed to load resource")) return "resource-error"
  return "unclassified-error"
}
