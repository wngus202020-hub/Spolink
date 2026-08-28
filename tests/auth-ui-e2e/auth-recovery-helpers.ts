import { randomBytes } from "node:crypto"
import type { Page } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import postgres from "postgres"
import { createRecoveryToken, RECOVERY_COOKIE, sha256HexUtf8 } from "@/lib/auth/flow-token"
import {
  readGuardedLocalStatus,
  readGuardedLocalStatusJson,
} from "../../scripts/supabase-local/local-status.mjs"
import { createLearnerCookieJar } from "../supabase-e2e/ssr-cookie-jar.mjs"

type RecoveryMarker = Readonly<{
  jti: string
  token: string
}>

type SessionClaims = Readonly<{
  sessionId: string
  sub: string
}>

type RecoveryMarkerClaims = SessionClaims &
  Readonly<{
    exp: number
  }>

export type RecoveryGrantProbe = Readonly<{
  grantExists: boolean
  grantIsActive: boolean
  grantSessionMatchesMarker: boolean
  grantUserMatchesMarker: boolean
  sessionCookieMatchesMarker: boolean
  sessionUserMatchesMarker: boolean
}>

type LiveAuthSession = Readonly<{
  claims: SessionClaims
  cookies: ReadonlyArray<Readonly<{ name: string; value: string }>>
  userId: string
}>

type SupabaseSsrCookie = Readonly<{
  name: string
  value: string
}>

type PlaywrightSupabaseCookie = SupabaseSsrCookie &
  Readonly<{
    sameSite: "Lax"
    url: string
  }>

export function makeTamperedRecoveryMarker(): string {
  const marker = createRecoveryToken({
    secret: testAuthFlowSecret(),
    sessionId: "session-id",
    sub: "user-id",
  })
  const [payloadSegment] = marker.token.split(".")
  return `${payloadSegment}.${randomBytes(32).toString("base64url")}`
}

export function makeExpiredRecoveryMarker(): string {
  return createRecoveryToken({
    now: 1,
    secret: testAuthFlowSecret(),
    sessionId: "session-id",
    sub: "user-id",
  }).token
}

export async function createLiveAuthSession(page: Page, email: string, password: string) {
  const status = await readTestSupabaseStatus()
  const serviceClient = createClient(status.apiUrl, status.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  })
  if (error) throw error
  if (!data.user?.id) throw new Error("Auth admin createUser did not return an id.")

  const jar = await createLearnerCookieJar({ email, password, status })
  const claims = readJwtClaims(jar.readSession().session.access_token)
  if (claims.sub !== data.user.id) {
    throw new Error("Canonical SSR session user did not match created Auth user.")
  }

  await page.goto("/")
  const origin = new URL(page.url()).origin
  await page.context().addCookies(toPlaywrightSupabaseCookies(origin, jar.getAll()))

  return { claims, cookies: jar.getAll(), userId: data.user.id } satisfies LiveAuthSession
}

async function readTestSupabaseStatus() {
  const statusJson = process.env["SPOLINK_AUTH_E2E_STATUS_JSON"]
  return statusJson ? readGuardedLocalStatusJson(statusJson) : readGuardedLocalStatus()
}

export function toPlaywrightSupabaseCookies(
  origin: string,
  cookies: ReadonlyArray<SupabaseSsrCookie>,
): ReadonlyArray<PlaywrightSupabaseCookie> {
  return cookies.map((cookie) => ({
    name: cookie.name,
    sameSite: "Lax",
    url: origin,
    value: cookie.value,
  }))
}

export async function createLiveRecoveryMarker(
  page: Page,
  session: LiveAuthSession,
): Promise<RecoveryMarker> {
  const claims = session.claims
  const marker = createRecoveryToken({
    secret: testAuthFlowSecret(),
    sessionId: claims.sessionId,
    sub: claims.sub,
  })
  await page.context().addCookies([
    {
      httpOnly: true,
      name: RECOVERY_COOKIE,
      sameSite: "Lax",
      url: new URL(page.url()).origin,
      value: marker.token,
    },
  ])
  return { jti: marker.jti, token: marker.token }
}

export async function issueLiveRecoveryGrant(marker: RecoveryMarker): Promise<void> {
  const dbUrl = requireDbUrl()
  const claims = readRecoveryMarkerClaims(marker.token)
  const sql = postgres(dbUrl, { idle_timeout: 1, max: 1 })
  try {
    const rows = await sql.begin(async (tx) => {
      await tx`
        select set_config(
          'request.jwt.claims',
          jsonb_build_object(
            'sub', ${claims.sub}::uuid,
            'role', 'authenticated',
            'session_id', ${claims.sessionId}::text
          )::text,
          true
        )
      `
      await tx`select set_config('request.jwt.claim.sub', ${claims.sub}::text, true)`
      await tx`select set_config('request.jwt.claim.role', 'authenticated', true)`
      await tx`set local role authenticated`
      return tx`
        select public.issue_password_recovery_grant(
          ${sha256HexUtf8(marker.jti)},
          ${new Date(claims.exp * 1_000).toISOString()}::timestamptz
        ) as ok
      `
    })
    if (rows[0]?.["ok"] !== true) throw new Error("Live recovery grant issue RPC returned false.")
  } finally {
    await sql.end({ timeout: 1 })
  }
}

export async function probeLiveRecoveryGrant(
  marker: RecoveryMarker,
  session: LiveAuthSession,
): Promise<RecoveryGrantProbe> {
  const dbUrl = requireDbUrl()
  const markerClaims = readRecoveryMarkerClaims(marker.token)
  const sql = postgres(dbUrl, { idle_timeout: 1, max: 1 })
  try {
    const [row] = await sql`
      select
        count(*)::int = 1 as grant_exists,
        bool_or(user_id = ${markerClaims.sub}::uuid) as grant_user_matches_marker,
        bool_or(session_id = ${markerClaims.sessionId}) as grant_session_matches_marker,
        bool_or(consumed_at is null and expires_at > statement_timestamp()) as grant_is_active
      from private.password_recovery_grants
      where token_hash = ${sha256HexUtf8(marker.jti)}
    `
    return {
      grantExists: row?.["grant_exists"] === true,
      grantIsActive: row?.["grant_is_active"] === true,
      grantSessionMatchesMarker: row?.["grant_session_matches_marker"] === true,
      grantUserMatchesMarker: row?.["grant_user_matches_marker"] === true,
      sessionCookieMatchesMarker: session.claims.sessionId === markerClaims.sessionId,
      sessionUserMatchesMarker: session.claims.sub === markerClaims.sub,
    }
  } finally {
    await sql.end({ timeout: 1 })
  }
}

export async function cleanupLiveAuthUser(email: string): Promise<void> {
  const dbUrl = process.env["SPOLINK_AUTH_E2E_DB_URL"]
  if (!dbUrl) return
  const sql = postgres(dbUrl, { idle_timeout: 1, max: 1 })
  try {
    await sql`delete from auth.users where email = ${email}`
  } finally {
    await sql.end({ timeout: 1 })
  }
}

function testAuthFlowSecret(): Buffer {
  return Buffer.alloc(32, 7)
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
  const parsed: unknown = JSON.parse(value)
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected JSON object.")
  }
  return Object.fromEntries(Object.entries(parsed))
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
  if (!dbUrl) throw new Error("SPOLINK_AUTH_E2E_DB_URL is required for live recovery coverage.")
  return dbUrl
}
