import type { CookieOptions } from "@supabase/ssr"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

import { readSupabasePublicEnv } from "../supabase/env"
import type { ModerationAction, ReportStatus, ReportTargetType } from "./types"

export type ReportRow = Readonly<{
  created_at: string
  detail: string | null
  id: string
  moderation_action: ModerationAction | null
  reason: string
  reporter_id: string
  resolution_note: string | null
  reviewed_at: string | null
  reviewed_by: string | null
  status: ReportStatus
  target_id: string
  target_type: ReportTargetType
  updated_at: string
}>

export type BlockRow = Readonly<{
  blocked_id: string
  blocker_id: string
  created_at: string
  id: string
  reason: string | null
}>

type ProfileRow = Readonly<{
  deleted_at: string | null
  id: string
  role: "admin" | "coach" | "learner"
  status: "active" | "coach_approved" | "deleted" | "pending_coach" | "suspended"
}>

type Table<Row> = Readonly<{
  Insert: Partial<Row>
  Relationships: []
  Row: Row
  Update: Partial<Row>
}>

type TrustSafetyDatabase = Readonly<{
  public: {
    CompositeTypes: Record<string, never>
    Enums: {
      moderation_action: ModerationAction
      report_status: ReportStatus
      report_target_type: ReportTargetType
    }
    Functions: {
      create_block: Readonly<{
        Args: Readonly<{ checked_blocked_id: string; checked_reason?: string | null }>
        Returns: readonly Readonly<{
          block_id: string
          blocked_id: string
          created_at: string
          idempotent: boolean
          reason: string | null
        }>[]
      }>
      create_report: Readonly<{
        Args: Readonly<{
          checked_detail?: string | null
          checked_reason: string
          checked_target_id: string
          checked_target_type: ReportTargetType
        }>
        Returns: readonly ReportRow[]
      }>
      resolve_report: Readonly<{
        Args: Readonly<{
          checked_action: "reject" | "resolve" | "start_review"
          checked_moderation_action: ModerationAction
          checked_report_id: string
          checked_resolution_note?: string | null
        }>
        Returns: readonly Readonly<{
          idempotent: boolean
          moderation_action: ModerationAction
          report_id: string
          report_status: ReportStatus
          reviewed_at: string
        }>[]
      }>
    }
    Tables: {
      blocks: Table<BlockRow>
      profiles: Table<ProfileRow>
      reports: Table<ReportRow>
    }
    Views: Record<string, never>
  }
}>

export async function createTrustSafetyServerClient(responseHeaders?: Headers) {
  const env = readSupabasePublicEnv()
  const cookieStore = await cookies()

  return createServerClient<TrustSafetyDatabase>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet, headers) {
        if (!responseHeaders) return
        for (const { name, options, value } of cookiesToSet) {
          cookieStore.set(name, value, options)
          responseHeaders.append("Set-Cookie", serializeCookie(name, value, options))
        }
        for (const [key, value] of Object.entries(headers ?? {})) {
          responseHeaders.append(key, value)
        }
      },
    },
  })
}

function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${value}`]
  if (typeof options.maxAge === "number") parts.push(`Max-Age=${options.maxAge}`)
  if (typeof options.domain === "string") parts.push(`Domain=${options.domain}`)
  if (typeof options.path === "string") parts.push(`Path=${options.path}`)
  if (options.expires instanceof Date) parts.push(`Expires=${options.expires.toUTCString()}`)
  if (options.httpOnly === true) parts.push("HttpOnly")
  if (options.secure === true) parts.push("Secure")
  if (typeof options.sameSite === "string") parts.push(`SameSite=${options.sameSite}`)
  if (options.sameSite === true) parts.push("SameSite=Strict")
  return parts.join("; ")
}

export type TrustSafetyClient = Awaited<ReturnType<typeof createTrustSafetyServerClient>>
