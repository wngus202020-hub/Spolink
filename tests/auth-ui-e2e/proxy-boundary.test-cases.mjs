import assert from "node:assert/strict"
import test from "node:test"
import { NextResponse } from "next/server.js"

import { withLoadedProxy } from "./proxy-test-loader.mjs"
import {
  assertMatcher,
  freshCookieChunks,
  nextRequest,
  nextResponse,
  noStoreHeaders,
  throwingRootProxyDependencies,
} from "./redirect-proxy-test-helpers.mjs"

test("root proxy evaluates matcher and bypasses route handlers before access", async () => {
  await withLoadedProxy(async ({ rootProxyModule }) => {
    assertMatcher(rootProxyModule.config, [
      ["/lessons", true],
      ["/api/me", true],
      ["/auth/callback", true],
      ["/_next/static/app.js", false],
      ["/_next/image", false],
      ["/favicon.ico", false],
      ["/logo.png", false],
    ])

    for (const pathname of [
      "/api/me",
      "/api/payments/confirm",
      "/auth/callback",
      "/auth/recovery/start",
      "/auth/update-password/submit",
      "/auth/logout",
      "/auth/restricted",
    ]) {
      const response = await rootProxyModule.proxyWithDependencies(
        nextRequest(pathname),
        throwingRootProxyDependencies(),
      )
      assert.equal(response.headers.get("x-spolink-next"), "1", pathname)
    }
  })
})

test("root proxy no-ops when Supabase is unconfigured and refreshes configured page requests", async () => {
  await withLoadedProxy(async ({ rootProxyModule }) => {
    let refreshCount = 0

    const unconfiguredResponse = await rootProxyModule.proxyWithDependencies(
      nextRequest("/lessons"),
      {
        getConfigStatus() {
          return { configured: false, invalidKeys: ["NEXT_PUBLIC_SUPABASE_URL"], missingKeys: [] }
        },
        next: nextResponse,
        async refreshSession() {
          throw new Error("refreshSession must not run when Supabase is unconfigured")
        },
      },
    )

    assert.equal(unconfiguredResponse.headers.get("x-spolink-next"), "1")

    const configuredResponse = await rootProxyModule.proxyWithDependencies(
      nextRequest("/lessons"),
      {
        getConfigStatus() {
          return { configured: true, invalidKeys: [], missingKeys: [] }
        },
        next: nextResponse,
        async refreshSession(request) {
          refreshCount += 1
          assert.equal(request.nextUrl.pathname, "/lessons")
          return new NextResponse(null, { headers: { "x-spolink-refreshed": "1" } })
        },
      },
    )

    assert.equal(refreshCount, 1)
    assert.equal(configuredResponse.headers.get("x-spolink-refreshed"), "1")
  })
})

test("proxy Supabase client refreshes claims and synchronizes request and response cookie chunks", async () => {
  await withLoadedProxy(async ({ proxyClientModule }) => {
    const request = nextRequest("/lessons", {
      cookie:
        "sb-spolink-auth-token.0=stale-header; sb-spolink-auth-token.1=stale-payload; theme=dark",
    })
    let afterWriteCookies = []
    let beforeWriteCookies = []
    let getClaimsCalls = 0

    const response = await proxyClientModule.refreshSupabaseSessionInProxy(request, {
      createClient(env, cookies) {
        assert.deepEqual(env, {
          supabaseAnonKey: "anon-key",
          supabaseUrl: "https://supabase.spolink.test",
        })
        beforeWriteCookies = cookies.getAll()

        return {
          auth: {
            async getClaims() {
              getClaimsCalls += 1
              cookies.setAll(freshCookieChunks(), noStoreHeaders())
              afterWriteCookies = cookies.getAll()
              return { data: { claims: { sub: "user-id" } }, error: null }
            },
          },
        }
      },
      readEnv() {
        return {
          supabaseAnonKey: "anon-key",
          supabaseUrl: "https://supabase.spolink.test",
        }
      },
    })

    assert.equal(getClaimsCalls, 1)
    assert.deepEqual(beforeWriteCookies, [
      { name: "sb-spolink-auth-token.0", value: "stale-header" },
      { name: "sb-spolink-auth-token.1", value: "stale-payload" },
      { name: "theme", value: "dark" },
    ])
    assert.deepEqual(afterWriteCookies, [
      { name: "sb-spolink-auth-token.0", value: "fresh-header" },
      { name: "sb-spolink-auth-token.1", value: "fresh-payload" },
      { name: "theme", value: "dark" },
    ])
    assert.equal(request.cookies.get("sb-spolink-auth-token.0")?.value, "fresh-header")
    assert.equal(request.cookies.get("sb-spolink-auth-token.1")?.value, "fresh-payload")
    assert.equal(response.cookies.get("sb-spolink-auth-token.0")?.value, "fresh-header")
    assert.equal(response.cookies.get("sb-spolink-auth-token.1")?.value, "fresh-payload")
    assert.equal(response.headers.get("Cache-Control"), "private, no-store")
    assert.equal(response.headers.get("Expires"), "0")
    assert.equal(response.headers.get("Pragma"), "no-cache")
  })
})
