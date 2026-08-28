"use client"

import { Check, LoaderCircle, RotateCcw } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { NotificationItem } from "@/lib/notifications/types"

export function NotificationList({ items }: { items: readonly NotificationItem[] }) {
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(
    () => new Set(items.filter((item) => item.readAt !== null).map((item) => item.id)),
  )
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errorId, setErrorId] = useState<string | null>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (errorId) errorRef.current?.focus()
  }, [errorId])

  async function markRead(id: string) {
    if (readIds.has(id)) return
    setBusyId(id)
    try {
      const response = await fetch(`/api/notifications/${id}/read`, {
        body: "{}",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      if (!response.ok) throw new Error("Notification read request failed.")
      setReadIds((current) => new Set(current).add(id))
      setErrorId(null)
    } catch (error) {
      if (error instanceof Error) setErrorId(id)
      else throw error
    } finally {
      setBusyId(null)
    }
  }

  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {items.map((item) => {
        const isRead = readIds.has(item.id)
        return (
          <li
            className={`grid gap-3 rounded-[var(--radius-lg)] border border-line p-4 ${isRead ? "bg-canvas" : "bg-accent-soft"}`}
            key={item.id}
          >
            {errorId === item.id ? (
              <p
                aria-live="assertive"
                className="m-0 flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--status-error)_24%,transparent)] bg-[color-mix(in_srgb,var(--status-error)_8%,transparent)] p-3 text-sm text-[var(--status-error)]"
                id={`notification-error-${item.id}`}
                ref={errorRef}
                role="alert"
                tabIndex={-1}
              >
                <span>읽음 처리에 실패했어요. 다시 시도해 주세요.</span>
                <button
                  aria-label="알림 읽음 처리 다시 시도"
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-canvas text-primary"
                  onClick={() => void markRead(item.id)}
                  type="button"
                >
                  <RotateCcw aria-hidden="true" className="size-4" />
                </button>
              </p>
            ) : null}
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1">
                <strong className="text-base text-primary">{item.title}</strong>
                {item.body ? (
                  <p className="m-0 text-sm leading-[1.6] text-secondary">{item.body}</p>
                ) : null}
              </div>
              <button
                aria-label={isRead ? "읽은 알림" : "알림 읽음 처리"}
                aria-describedby={errorId === item.id ? `notification-error-${item.id}` : undefined}
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-canvas text-primary disabled:opacity-50"
                disabled={isRead || busyId === item.id}
                onClick={() => void markRead(item.id)}
                type="button"
              >
                {busyId === item.id ? (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <Check aria-hidden="true" className="size-4" />
                )}
              </button>
            </div>
            <time className="text-xs text-secondary" dateTime={item.createdAt}>
              {new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(
                new Date(item.createdAt),
              )}
            </time>
          </li>
        )
      })}
    </ul>
  )
}
