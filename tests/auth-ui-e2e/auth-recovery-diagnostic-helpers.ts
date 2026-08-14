import type { Page } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import postgres from "postgres"
import { RECOVERY_COOKIE, sha256HexUtf8 } from "@/lib/auth/flow-token"
import { readGuardedLocalStatus } from "../supabase-e2e/local-status.mjs"
import { SsrCookieJar } from "../supabase-e2e/ssr-cookie-jar.mjs"
import type { createLiveAuthSession, createLiveRecoveryMarker } from "./auth-recovery-helpers"

type LiveAuthSession = Awaited<ReturnType<typeof createLiveAuthSession>>
type RecoveryMarker = Awaited<ReturnType<typeof createLiveRecoveryMarker>>

type SessionClaims = Readonly<{
  sessionId: string
  sub: string
}>

type RecoveryMarkerClaims = SessionClaims &
  Readonly<{
    exp: number
  }>

type SafeRpcError = Readonly<{
  code: string | null
  messageClass: "auth" | "invalid-input" | "network" | "none" | "other" | "permission"
}>

export type DirectRecoveryGrantRpcDiagnostic = Readonly<{
  data: boolean | null
  error: SafeRpcError
}>

export type BrowserRecoveryClaimsDiagnostic = Readonly<{
  sessionMatchesMarker: boolean
  userMatchesMarker: boolean
}>

export type RecoveryGrantStateDiagnostic = Readonly<{
  active: boolean
  consumed: boolean
}>

export type RecoveryPostCookieDiagnostic = Readonly<{
  authCookieCount: number
  markerCookiePresent: boolean
  names: readonly string[]
}>

export async function consumeRecoveryGrantWithCanonicalAccessToken(
  marker: RecoveryMarker,
  session: LiveAuthSession,
): Promise<DirectRecoveryGrantRpcDiagnostic> {
  const status = await readGuardedLocalStatus()
  const accessToken = readCanonicalAccessToken(session)
  const supabase = createClient(status.apiUrl, status.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
  const { data, error } = await supabase.rpc("consume_password_recovery_grant", {
    checked_token_hash: sha256HexUtf8(marker.jti),
  })
  return {
    data: typeof data === "boolean" ? data : null,
    error: classifyRpcError(error),
  }
}

export async function readBrowserClaimsDiagnostic(
  page: Page,
  marker: RecoveryMarker,
): Promise<BrowserRecoveryClaimsDiagnostic> {
  const browserClaims = readAccessTokenClaimsFromCookies(await page.context().cookies())
  const markerClaims = readRecoveryMarkerClaims(marker.token)
  return {
    sessionMatchesMarker: browserClaims.sessionId === markerClaims.sessionId,
    userMatchesMarker: browserClaims.sub === markerClaims.sub,
  }
}

export async function probeRecoveryGrantState(
  marker: RecoveryMarker,
): Promise<RecoveryGrantStateDiagnostic> {
  const dbUrl = requireDbUrl()
  const sql = postgres(dbUrl, { idle_timeout: 1, max: 1 })
  try {
    const [row] = await sql`
      select
        bool_or(consumed_at is null and expires_at > statement_timestamp()) as grant_is_active,
        bool_or(consumed_at is not null) as grant_is_consumed
      from private.password_recovery_grants
      where token_hash = ${sha256HexUtf8(marker.jti)}
    `
    return {
      active: row?.["grant_is_active"] === true,
      consumed: row?.["grant_is_consumed"] === true,
    }
  } finally {
    await sql.end({ timeout: 1 })
  }
}

export function readPostCookieDiagnostic(
  cookieHeader: string | undefined,
): RecoveryPostCookieDiagnostic {
  const names = readCookieNames(cookieHeader)
  return {
    authCookieCount: names.filter((name) => name.includes("-auth-token")).length,
    markerCookiePresent: names.includes(RECOVERY_COOKIE),
    names,
  }
}

function readCanonicalAccessToken(session: LiveAuthSession): string {
  return readAccessTokenFromCookies(session.cookies)
}

function readAccessTokenClaimsFromCookies(
  cookies: readonly Readonly<{ name: string; value: string }>[],
): SessionClaims {
  return readJwtClaims(readAccessTokenFromCookies(cookies))
}

function readAccessTokenFromCookies(
  cookies: readonly Readonly<{ name: string; value: string }>[],
): string {
  const jar = new SsrCookieJar()
  for (const cookie of cookies) jar.setCookie(cookie)
  return jar.readSession().session.access_token
}

function readCookieNames(cookieHeader: string | undefined): readonly string[] {
  if (!cookieHeader) return []
  return cookieHeader
    .split(";")
    .map((part) => part.trim().split("=")[0] ?? "")
    .filter((name) => name.length > 0)
    .sort()
}

function classifyRpcError(error: unknown): SafeRpcError {
  if (!error) return { code: null, messageClass: "none" }
  const record = readRecord(error)
  const code = typeof record["code"] === "string" ? record["code"] : null
  const message = typeof record["message"] === "string" ? record["message"].toLowerCase() : ""
  if (message.includes("permission")) return { code, messageClass: "permission" }
  if (message.includes("jwt") || message.includes("auth")) return { code, messageClass: "auth" }
  if (message.includes("invalid")) return { code, messageClass: "invalid-input" }
  if (message.includes("fetch") || message.includes("network"))
    return { code, messageClass: "network" }
  return { code, messageClass: "other" }
}

function readRecoveryMarkerClaims(marker: string): RecoveryMarkerClaims {
  const [payloadSegment] = marker.split(".")
  if (!payloadSegment) throw new Error("Recovery marker payload is missing.")
  const payload = parseJsonRecord(Buffer.from(payloadSegment, "base64url").toString("utf8"))
  const exp = readNumber(payload, "exp")
  const sub = readString(payload, "sub")
  const sessionId = readString(payload, "sessionId")
  if (!sub || !sessionId || exp === null) throw new Error("Recovery marker claims are missing.")
  return { exp, sessionId, sub }
}

function readJwtClaims(token: string): SessionClaims {
  const [, payloadSegment] = token.split(".")
  if (!payloadSegment) throw new Error("Access token payload is missing.")
  const payload = parseJsonRecord(Buffer.from(payloadSegment, "base64url").toString("utf8"))
  const sub = readString(payload, "sub")
  const sessionId = readString(payload, "session_id")
  if (!sub || !sessionId) throw new Error("Access token claims are missing.")
  return { sessionId, sub }
}

function parseJsonRecord(value: string): Record<string, unknown> {
  return readRecord(JSON.parse(value))
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected JSON object.")
  }
  return Object.fromEntries(Object.entries(value))
}

function readString(value: Record<string, unknown>, key: string): string | null {
  const entry = value[key]
  return typeof entry === "string" && entry.length > 0 ? entry : null
}

function readNumber(value: Record<string, unknown>, key: string): number | null {
  const entry = value[key]
  return typeof entry === "number" ? entry : null
}

function requireDbUrl(): string {
  const dbUrl = process.env["SPOLINK_AUTH_E2E_DB_URL"]
  if (!dbUrl) throw new Error("SPOLINK_AUTH_E2E_DB_URL is required for recovery diagnostics.")
  return dbUrl
}
