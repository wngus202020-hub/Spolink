import assert from "node:assert/strict"
import { fileURLToPath, pathToFileURL } from "node:url"
import { compile } from "tailwindcss"

import { require } from "./mypage-reviews-ui-runtime.mjs"

export async function assertNoHorizontalOverflow(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
    true,
  )
}

export async function compileReviewUtilityCss(page) {
  const candidates = await page
    .locator("[class]")
    .evaluateAll((nodes) => [...new Set(nodes.flatMap((node) => [...node.classList]))])
  const compiler = await compile(
    `@import "tailwindcss";
@theme { --spacing: 0.25rem; }
:root { --type-body-lg-size: 18px; }
body { margin: 0; font-size: 16px; line-height: 1.55; word-break: keep-all; }`,
    {
      base: process.cwd(),
      async loadStylesheet(specifier, from) {
        const resolved =
          specifier === "tailwindcss"
            ? require.resolve("tailwindcss/index.css")
            : require.resolve(specifier, { paths: [from ?? process.cwd()] })
        return {
          base: fileURLToPath(pathToFileURL(resolved)),
          content: await import("node:fs/promises").then(({ readFile }) =>
            readFile(resolved, "utf8"),
          ),
        }
      },
    },
  )
  return compiler.build(candidates)
}

export async function readElementRect(locator) {
  return locator.evaluate((node) => {
    const rect = node.getBoundingClientRect()
    return { height: rect.height, width: rect.width }
  })
}

export function findElementByType(element, type) {
  if (!element || typeof element !== "object") return null
  if (element.type === type) return element
  const children = element.props?.children
  const values = Array.isArray(children) ? children : [children]
  for (const child of values) {
    const found = findElementByType(child, type)
    if (found) return found
  }
  return null
}

export function removeMinimumHeightFromLink(element, href) {
  if (!element || typeof element !== "object") return element
  const children = element.props?.children
  const mapped = (Array.isArray(children) ? children : [children]).map((child) =>
    removeMinimumHeightFromLink(child, href),
  )
  const nextChildren = Array.isArray(children) ? mapped : mapped[0]
  if (element.props?.href === href) {
    const className = element.props.className
      ?.split(/\s+/u)
      .filter((candidate) => !candidate.startsWith("min-h-"))
      .join(" ")
    return { ...element, props: { ...element.props, children: nextChildren, className } }
  }
  return { ...element, props: { ...element.props, children: nextChildren } }
}
