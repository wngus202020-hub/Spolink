import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("smooth root scrolling declares the Next route-transition behavior", async () => {
  const [css, layout] = await Promise.all([
    readFile("app/globals.css", "utf8"),
    readFile("app/layout.tsx", "utf8"),
  ])

  assert.match(css, /scroll-behavior:\s*smooth/u)
  assert.match(layout, /<html\s+data-scroll-behavior="smooth"\s+lang="ko">/u)
})
