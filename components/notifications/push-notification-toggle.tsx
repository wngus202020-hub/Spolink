"use client"

import { BellOff, BellRing, LoaderCircle } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import {
  type BrowserPushState,
  disableBrowserPush,
  enableBrowserPush,
  readBrowserPushState,
} from "@/lib/notifications/push-browser-client"

type ToggleState = BrowserPushState | "checking" | "error"

export function PushNotificationToggle({ publicKey }: Readonly<{ publicKey: string }>) {
  const [state, setState] = useState<ToggleState>("checking")
  const [busy, setBusy] = useState(false)
  const errorRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    let active = true
    void readBrowserPushState().then((nextState) => {
      if (active) setState(nextState)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (state === "error") errorRef.current?.focus()
  }, [state])

  async function toggle() {
    if (busy || state === "checking" || state === "denied" || state === "unsupported") return
    setBusy(true)
    const result =
      state === "enabled" ? await disableBrowserPush() : await enableBrowserPush(publicKey)
    setBusy(false)
    setState(result.status === "failure" ? "error" : result.status)
  }

  const enabled = state === "enabled"
  const disabled = busy || state === "checking" || state === "denied" || state === "unsupported"

  return (
    <section
      aria-labelledby="push-notification-heading"
      className="flex items-center justify-between gap-4 border-y border-line py-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-inset text-primary">
          {enabled ? (
            <BellRing aria-hidden="true" className="size-5" />
          ) : (
            <BellOff aria-hidden="true" className="size-5" />
          )}
        </span>
        <div className="grid min-w-0 gap-1">
          <h2 className="m-0 text-base font-bold text-primary" id="push-notification-heading">
            푸시 알림
          </h2>
          <p className="m-0 break-keep text-sm text-secondary">{stateMessage(state)}</p>
          {state === "error" ? (
            <p
              className="m-0 text-sm text-[var(--status-error)] focus:outline-2 focus:outline-offset-2 focus:outline-primary"
              ref={errorRef}
              role="alert"
              tabIndex={-1}
            >
              설정을 변경하지 못했어요. 다시 시도해 주세요.
            </p>
          ) : null}
        </div>
      </div>
      <button
        aria-checked={enabled}
        aria-label={enabled ? "푸시 알림 끄기" : "푸시 알림 켜기"}
        className="relative h-11 w-14 shrink-0 rounded-full focus:outline-2 focus:outline-offset-2 focus:outline-primary disabled:opacity-60"
        disabled={disabled}
        onClick={() => void toggle()}
        role="switch"
        type="button"
      >
        <span
          aria-hidden="true"
          className={`absolute left-1 top-2 h-7 w-12 rounded-full border ${enabled ? "border-accent bg-accent" : "border-line bg-inset"}`}
        />
        <span
          aria-hidden="true"
          className={`absolute left-1.5 top-2.5 inline-flex size-5 items-center justify-center rounded-full bg-canvas transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`}
        >
          {busy || state === "checking" ? (
            <LoaderCircle aria-hidden="true" className="size-3 animate-spin text-secondary" />
          ) : null}
        </span>
      </button>
    </section>
  )
}

function stateMessage(state: ToggleState): string {
  switch (state) {
    case "checking":
      return "현재 설정을 확인하고 있어요."
    case "enabled":
      return "중요한 예약 변화를 기기에서 바로 알려드려요."
    case "disabled":
    case "error":
      return "브라우저를 닫아도 중요한 예약 변화를 받을 수 있어요."
    case "denied":
      return "브라우저 설정에서 알림 권한을 허용해 주세요."
    case "unsupported":
      return "이 브라우저에서는 푸시 알림을 사용할 수 없어요."
    default:
      return state satisfies never
  }
}
