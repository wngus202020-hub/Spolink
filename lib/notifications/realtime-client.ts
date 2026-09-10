"use client"

import ky from "ky"

import { parseNotificationPageItems } from "./realtime"
import type { NotificationItem } from "./types"

export async function readLatestNotifications(): Promise<readonly NotificationItem[] | null> {
  try {
    const response: unknown = await ky
      .get("/api/notifications", {
        searchParams: { page: 1, pageSize: 50, unreadOnly: false },
        retry: 0,
        timeout: 10_000,
      })
      .json()
    return parseNotificationPageItems(response)
  } catch (error) {
    if (error instanceof Error) return null
    throw error
  }
}
