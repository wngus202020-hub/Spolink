import assert from "node:assert/strict"
import { register } from "node:module"
import test from "node:test"

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@/")) return nextResolve(new URL(specifier.slice(2) + ".ts", ${JSON.stringify(new URL("../", import.meta.url).href)}).href, context)
      try { return await nextResolve(specifier, context) } catch (error) {
        if (error?.code === "ERR_MODULE_NOT_FOUND" && (specifier.startsWith("./") || specifier.startsWith("../"))) return nextResolve(specifier + ".ts", context)
        throw error
      }
    }
  `)}`,
  import.meta.url,
)

test("withdrawal confirmation accepts only the exact destructive phrase", async () => {
  const { parseAccountWithdrawalRequest } = await import("../lib/account/withdrawal.ts")

  assert.equal(parseAccountWithdrawalRequest({ confirmation: "탈퇴하기" }).status, "success")
  assert.equal(parseAccountWithdrawalRequest({ confirmation: " 탈퇴하기 " }).status, "failure")
  assert.equal(parseAccountWithdrawalRequest({ confirmation: "탈퇴" }).status, "failure")
  assert.equal(
    parseAccountWithdrawalRequest({ confirmation: "탈퇴하기", userId: "foreign" }).status,
    "failure",
  )
})

test("withdrawal derives the account owner and clears the avatar before soft deletion", async () => {
  const { runAccountWithdrawal } = await import("../lib/account/withdrawal.ts")
  const calls = []

  const result = await runAccountWithdrawal({
    getVerifiedUserId: async () => "account-owner",
    readProfile: async (userId) => {
      calls.push(["read", userId])
      return { avatarPath: "profiles/account-owner/avatar", status: "found" }
    },
    removeAvatar: async (avatarPath) => {
      calls.push(["remove", avatarPath])
      return { status: "success" }
    },
    withdrawAccount: async () => {
      calls.push(["withdraw"])
      return {
        status: "success",
        withdrawal: {
          account_id: "account-owner",
          deleted_at: "2026-09-04T01:00:00.000Z",
          idempotent: false,
        },
      }
    },
  })

  assert.deepEqual(calls, [
    ["read", "account-owner"],
    ["remove", "profiles/account-owner/avatar"],
    ["withdraw"],
  ])
  assert.deepEqual(result, {
    response: { data: { deletedAt: "2026-09-04T01:00:00.000Z", idempotent: false } },
    status: "success",
    statusCode: 200,
  })
})

test("withdrawal stops before profile mutation when avatar cleanup fails", async () => {
  const { runAccountWithdrawal } = await import("../lib/account/withdrawal.ts")
  let withdrew = false

  const result = await runAccountWithdrawal({
    getVerifiedUserId: async () => "account-owner",
    readProfile: async () => ({ avatarPath: "profiles/account-owner/avatar", status: "found" }),
    removeAvatar: async () => ({ status: "failure" }),
    withdrawAccount: async () => {
      withdrew = true
      return { errorCode: "unexpected", status: "failure" }
    },
  })

  assert.equal(withdrew, false)
  assert.deepEqual(result, {
    error: {
      code: "ACCOUNT_CLEANUP_FAILED",
      message: "Unable to remove account media.",
      statusCode: 503,
    },
    status: "failure",
  })
})

test("withdrawal rejects unauthenticated and missing-profile sessions", async () => {
  const { runAccountWithdrawal } = await import("../lib/account/withdrawal.ts")
  const unused = async () => {
    throw new Error("unexpected dependency call")
  }

  const unauthenticated = await runAccountWithdrawal({
    getVerifiedUserId: async () => null,
    readProfile: unused,
    removeAvatar: unused,
    withdrawAccount: unused,
  })
  assert.equal(unauthenticated.status, "failure")
  assert.equal(unauthenticated.error.code, "UNAUTHORIZED")

  const missingProfile = await runAccountWithdrawal({
    getVerifiedUserId: async () => "account-owner",
    readProfile: async () => ({ status: "missing" }),
    removeAvatar: unused,
    withdrawAccount: unused,
  })
  assert.equal(missingProfile.status, "failure")
  assert.equal(missingProfile.error.code, "PROFILE_REQUIRED")
})

test("account route rejects cross-origin and client-selected account input before session access", async () => {
  const { NextRequest } = await import("next/server.js")
  const { createAccountWithdrawalRouteHandler } = await import("../lib/account/route-handler.ts")
  let contextCalls = 0
  const handler = createAccountWithdrawalRouteHandler({
    clearSession: () => {},
    createContext: async () => {
      contextCalls += 1
      throw new Error("unexpected context creation")
    },
    isSupabaseConfigured: () => true,
  })

  const crossOrigin = await handler(
    new NextRequest("http://127.0.0.1:3000/api/account", {
      body: JSON.stringify({ confirmation: "탈퇴하기" }),
      headers: { "Content-Type": "application/json", Origin: "https://attacker.test" },
      method: "DELETE",
    }),
  )
  assert.equal(crossOrigin.status, 403)

  const selectedAccount = await handler(
    new NextRequest("http://127.0.0.1:3000/api/account", {
      body: JSON.stringify({ confirmation: "탈퇴하기", userId: "foreign-account" }),
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3000" },
      method: "DELETE",
    }),
  )
  assert.equal(selectedAccount.status, 422)
  assert.equal(contextCalls, 0)
})

test("account route signs out and clears cookies only after withdrawal succeeds", async () => {
  const { NextRequest } = await import("next/server.js")
  const { createAccountWithdrawalRouteHandler } = await import("../lib/account/route-handler.ts")
  const events = []
  const handler = createAccountWithdrawalRouteHandler({
    clearSession: (response) => {
      events.push("clear")
      response.cookies.set("session-cleared", "1")
    },
    createContext: async () => ({
      signOut: async () => events.push("sign-out"),
      workflow: {
        getVerifiedUserId: async () => "account-owner",
        readProfile: async () => ({ avatarPath: null, status: "found" }),
        removeAvatar: async () => ({ status: "success" }),
        withdrawAccount: async () => ({
          status: "success",
          withdrawal: {
            account_id: "account-owner",
            deleted_at: "2026-09-04T01:00:00.000Z",
            idempotent: false,
          },
        }),
      },
    }),
    isSupabaseConfigured: () => true,
  })

  const response = await handler(
    new NextRequest("http://127.0.0.1:3000/api/account", {
      body: JSON.stringify({ confirmation: "탈퇴하기" }),
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3000" },
      method: "DELETE",
    }),
  )

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(events, ["sign-out", "clear"])
})
