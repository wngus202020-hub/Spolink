import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server.js"
import { NextRequest, NextResponse } from "next/server.js"

const nextConfigModuleUrl = pathToFileURL(`${process.cwd()}/next.config.ts`).href

export function nextRequest(pathname, headers = {}) {
  return new NextRequest(`https://spolink.test${pathname}`, { headers })
}

export function nextResponse() {
  return new NextResponse(null, { headers: { "x-spolink-next": "1" } })
}

export function assertMatcher(config, cases) {
  for (const [url, expected] of cases) {
    assert.equal(unstable_doesMiddlewareMatch({ config, url }), expected, url)
  }
}

export function freshCookieChunks() {
  return [
    {
      name: "sb-spolink-auth-token.0",
      options: { httpOnly: true, path: "/", sameSite: "lax" },
      value: "fresh-header",
    },
    {
      name: "sb-spolink-auth-token.1",
      options: { httpOnly: true, path: "/", sameSite: "lax" },
      value: "fresh-payload",
    },
  ]
}

export function noStoreHeaders() {
  return {
    "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
    Expires: "0",
    Pragma: "no-cache",
  }
}

export function throwingRootProxyDependencies() {
  return {
    getConfigStatus() {
      throw new Error("getConfigStatus must not run for route-handler bypasses")
    },
    next: nextResponse,
    async refreshSession() {
      throw new Error("refreshSession must not run for route-handler bypasses")
    },
  }
}

export async function importFreshNextConfig(env) {
  const previousEnv = {
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  }

  try {
    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value
    }
    return await import(`${nextConfigModuleUrl}?cacheBust=${Date.now()}-${Math.random()}`)
  } finally {
    restoreEnvValue("NEXT_PUBLIC_SUPABASE_ANON_KEY", previousEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    restoreEnvValue("NEXT_PUBLIC_SUPABASE_URL", previousEnv.NEXT_PUBLIC_SUPABASE_URL)
  }
}

function restoreEnvValue(key, value) {
  if (typeof value === "string") {
    process.env[key] = value
  } else {
    Reflect.deleteProperty(process.env, key)
  }
}
