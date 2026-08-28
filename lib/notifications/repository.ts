import type { SupabaseAppClient } from "@/lib/supabase/server"
import type { NotificationItem, NotificationPage, NotificationQuery } from "./types"
import { encodeNotificationCursor } from "./types"

export type NotificationRepository = Readonly<{
  list: (userId: string, query: NotificationQuery) => Promise<NotificationPage | null>
  markRead: (userId: string, notificationId: string) => Promise<"read" | "not_found" | "error">
}>

export function createNotificationRepository(client: SupabaseAppClient): NotificationRepository {
  return {
    list: async (userId, query) => {
      const limit = query.pageSize + 1
      let request = client
        .from("notifications")
        .select("id,type,title,body,data,read_at,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit)

      if (query.unreadOnly) request = request.is("read_at", null)
      if (query.cursor) {
        request = request.or(
          `created_at.lt.${query.cursor.createdAt},and(created_at.eq.${query.cursor.createdAt},id.lt.${query.cursor.id})`,
        )
      }

      const result = await request
      if (result.error) return null
      const rows = result.data ?? []
      const hasNextPage = rows.length > query.pageSize
      const visibleRows = rows.slice(0, query.pageSize)
      const last = visibleRows.at(-1)
      return {
        items: visibleRows.map(mapNotification),
        meta: {
          hasNextPage,
          nextCursor:
            hasNextPage && last
              ? encodeNotificationCursor({ createdAt: last.created_at, id: last.id })
              : null,
          page: query.page,
          pageSize: query.pageSize,
        },
      }
    },
    markRead: async (userId, notificationId) => {
      const result = await client
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", notificationId)
        .eq("user_id", userId)
        .is("read_at", null)
        .select("id")
        .maybeSingle()
      if (result.error) return "error"
      if (result.data) return "read"

      const current = await client
        .from("notifications")
        .select("id,read_at")
        .eq("id", notificationId)
        .eq("user_id", userId)
        .maybeSingle()
      if (current.error) return "error"
      if (!current.data) return "not_found"
      return current.data.read_at !== null ? "read" : "error"
    },
  }
}

function mapNotification(row: {
  body: string | null
  created_at: string
  data: unknown
  id: string
  read_at: string | null
  title: string
  type: NotificationItem["type"]
}): NotificationItem {
  return {
    body: row.body,
    createdAt: row.created_at,
    data: isSafeData(row.data) ? row.data : null,
    id: row.id,
    readAt: row.read_at,
    title: row.title,
    type: row.type,
  }
}

function isSafeData(value: unknown): value is Record<string, boolean | null | number | string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (item) => item === null || ["boolean", "number", "string"].includes(typeof item),
    )
  )
}
