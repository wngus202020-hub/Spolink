import type { Database } from "@/lib/supabase/database.types"

export type NotificationType = Database["public"]["Enums"]["notification_type"]
export type NotificationData = Readonly<Record<string, boolean | null | number | string>>

export type NotificationItem = Readonly<{
  body: string | null
  createdAt: string
  data: NotificationData | null
  id: string
  readAt: string | null
  title: string
  type: NotificationType
}>

export type NotificationPage = Readonly<{
  items: readonly NotificationItem[]
  meta: Readonly<{
    hasNextPage: boolean
    nextCursor: string | null
    page: number
    pageSize: number
  }>
}>

export type NotificationQuery = Readonly<{
  cursor: Readonly<{ createdAt: string; id: string }> | null
  page: number
  pageSize: number
  unreadOnly: boolean
}>

export function encodeNotificationCursor(cursor: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

export function decodeNotificationCursor(value: string | null): NotificationQuery["cursor"] {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    if (
      !isRecord(parsed) ||
      typeof parsed["createdAt"] !== "string" ||
      typeof parsed["id"] !== "string"
    ) {
      return null
    }
    return { createdAt: parsed["createdAt"], id: parsed["id"] }
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
