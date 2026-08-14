import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { importFreshNextConfig } from "./redirect-proxy-test-helpers.mjs"

test("configured lesson pages declare private no-store at the Next route header boundary", async () => {
  const { default: nextConfig } = await importFreshNextConfig({
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  })

  assert.equal(typeof nextConfig.headers, "function")
  const headers = await nextConfig.headers()

  assert.deepEqual(headers, [
    {
      headers: [{ key: "Cache-Control", value: "private, no-store" }],
      source: "/lessons",
    },
    {
      headers: [{ key: "Cache-Control", value: "private, no-store" }],
      source: "/lessons/:path*",
    },
  ])
})

test("lesson page declares dynamic no-store route segment behavior", async () => {
  const source = await readFile("app/lessons/page.tsx", "utf8")

  assert.match(source, /export const dynamic = "force-dynamic"/)
  assert.match(source, /export const revalidate = 0/)
})

test("unconfigured route headers do not add proxy cache behavior", async () => {
  const { default: nextConfig } = await importFreshNextConfig({
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    NEXT_PUBLIC_SUPABASE_URL: "",
  })

  assert.equal(typeof nextConfig.headers, "function")
  assert.deepEqual(await nextConfig.headers(), [])
})
