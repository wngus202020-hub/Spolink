import { z } from "zod"

import type { NotificationItem } from "./types"

const notificationTypes = [
  "coach_certification.reviewed",
  "coach_certification.submitted",
  "refund.result",
  "report.resolved",
  "reservation.completed",
  "reservation.no_show",
  "reservation_cancelled",
  "reservation_confirmed",
  "review.requested",
  "settlement.status_changed",
] as const

const notificationDataValueSchema = z.union([z.boolean(), z.null(), z.number(), z.string()])
const realtimeNotificationSchema = z.object({
  body: z.string().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  data: z.record(z.string(), notificationDataValueSchema).nullable(),
  id: z.uuid(),
  read_at: z.iso.datetime({ offset: true }).nullable(),
  title: z.string().min(1),
  type: z.enum(notificationTypes),
})

const apiNotificationSchema = z.object({
  body: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  data: z.record(z.string(), notificationDataValueSchema).nullable(),
  id: z.uuid(),
  readAt: z.iso.datetime({ offset: true }).nullable(),
  title: z.string().min(1),
  type: z.enum(notificationTypes),
})

const notificationPageResponseSchema = z.object({
  data: z.object({ items: z.array(apiNotificationSchema) }),
})

const realtimeSystemPayloadSchema = z.object({
  extension: z.enum(["postgres_changes", "system"]),
  status: z.enum(["error", "ok"]),
})

export function parseRealtimeNotification(value: unknown): NotificationItem | null {
  const parsed = realtimeNotificationSchema.safeParse(value)
  if (!parsed.success) return null

  return {
    body: parsed.data.body,
    createdAt: parsed.data.created_at,
    data: parsed.data.data,
    id: parsed.data.id,
    readAt: parsed.data.read_at,
    title: parsed.data.title,
    type: parsed.data.type,
  }
}

export function parseNotificationPageItems(value: unknown): readonly NotificationItem[] | null {
  const parsed = notificationPageResponseSchema.safeParse(value)
  return parsed.success ? parsed.data.data.items : null
}

export function readReplicationReadiness(value: unknown): "error" | "ignore" | "ready" {
  const parsed = realtimeSystemPayloadSchema.safeParse(value)
  if (!parsed.success) return "ignore"
  return parsed.data.status === "ok" ? "ready" : "error"
}
