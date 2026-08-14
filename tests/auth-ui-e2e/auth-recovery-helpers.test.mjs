import assert from "node:assert/strict"
import { register } from "node:module"
import test from "node:test"
import { pathToFileURL } from "node:url"

const repoUrl = pathToFileURL(`${process.cwd()}/`).href

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@/")) return nextResolve("${repoUrl}" + specifier.slice(2) + ".ts", context);
      return nextResolve(specifier, context);
    }
  `)}`,
  import.meta.url,
)

const { toPlaywrightSupabaseCookies } = await import("./auth-recovery-helpers.ts")

test("canonical SSR auth cookies map to Playwright cookies with origin URL only", () => {
  const cookies = [
    { name: "sb-local-auth-token.0", value: "base64-head" },
    { name: "sb-local-auth-token.1", value: "base64-tail" },
  ]

  const mapped = toPlaywrightSupabaseCookies("http://127.0.0.1:3009", cookies)

  assert.deepEqual(mapped, [
    {
      name: "sb-local-auth-token.0",
      sameSite: "Lax",
      url: "http://127.0.0.1:3009",
      value: "base64-head",
    },
    {
      name: "sb-local-auth-token.1",
      sameSite: "Lax",
      url: "http://127.0.0.1:3009",
      value: "base64-tail",
    },
  ])
  for (const cookie of mapped) {
    assert.equal(Object.hasOwn(cookie, "path"), false)
    assert.equal(Object.hasOwn(cookie, "domain"), false)
  }
})
