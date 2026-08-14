import { NextRequest } from "next/server.js"

export const TEST_ORIGIN = "https://spolink.test"
export const TEST_SUPABASE_URL = "https://abcdefghijklmnop.supabase.co"
export const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
export const TEST_SESSION_ID = "session-123"

export function testSecret() {
  return Buffer.alloc(32, 7)
}

export function routeRequest(path, options = {}) {
  const headers = new Headers(options.headers)
  if (options.origin !== null) headers.set("origin", options.origin ?? TEST_ORIGIN)
  if (options.cookie) headers.set("cookie", options.cookie)
  if (options.body !== undefined) headers.set("content-type", "application/json")

  return new NextRequest(`${TEST_ORIGIN}${path}`, {
    body: serializeBody(options.body),
    headers,
    method: options.method ?? "POST",
  })
}

export async function readJson(response) {
  return response.json()
}

export function setCookieHeader(response) {
  return response.headers.get("set-cookie") ?? ""
}

export function makeSupabaseHarness(options = {}) {
  const calls = []
  const profile = Object.hasOwn(options, "profile")
    ? options.profile
    : { deleted_at: null, status: "active" }
  const harness = {
    calls,
    resetArgs: null,
    rpcArgs: null,
    signOutArgs: null,
    updateArgs: null,
  }
  const supabase = {
    auth: {
      exchangeCodeForSession: async (code) => {
        calls.push(`exchange:${code}`)
        return { error: options.exchangeError ?? null }
      },
      getClaims: async () => {
        calls.push("claims")
        return {
          data: { claims: options.claims ?? { session_id: TEST_SESSION_ID, sub: TEST_USER_ID } },
          error: options.claimsError ?? null,
        }
      },
      resetPasswordForEmail: async (email, requestOptions) => {
        calls.push("reset")
        harness.resetArgs = { email, requestOptions }
        if (options.resetThrows) throw options.resetThrows
        return { error: options.resetError ?? null }
      },
      signOut: async (signOutOptions) => {
        calls.push("signOut")
        harness.signOutArgs = signOutOptions
        return { error: options.signOutError ?? null }
      },
      updateUser: async (update) => {
        calls.push("updateUser")
        harness.updateArgs = update
        return { error: options.updateError ?? null }
      },
    },
    from: () => ({
      eq: () => ({
        maybeSingle: async () => {
          calls.push("profile")
          return { data: profile, error: options.profileError ?? null }
        },
      }),
      select() {
        return this
      },
    }),
    rpc: async (name, args) => {
      calls.push(`rpc:${name}`)
      harness.rpcArgs = args
      if (options.rpc) return options.rpc(name, args)
      return { data: options.rpcData ?? true, error: options.rpcError ?? null }
    },
  }

  harness.dependencies = {
    createSupabaseClient: async (headers) => {
      calls.push("client")
      if (options.responseCookie) headers.append("Set-Cookie", options.responseCookie)
      return supabase
    },
    getSupabaseConfigured: () => {
      calls.push("config")
      return options.configured ?? true
    },
    readPublicEnv: () => {
      calls.push("public-env")
      return { supabaseUrl: TEST_SUPABASE_URL }
    },
    readSecret: () => {
      calls.push("secret")
      if (options.secretError) throw options.secretError
      return options.secret ?? testSecret()
    },
  }

  return harness
}

export function namedConfigError() {
  const error = new Error("Authentication flow is not configured.")
  error.name = "AuthFlowConfigError"
  return error
}

function serializeBody(body) {
  if (body === undefined) return undefined
  return typeof body === "string" ? body : JSON.stringify(body)
}
