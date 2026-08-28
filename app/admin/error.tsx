"use client"

import { useEffect, useRef } from "react"

import { Button } from "@/components/ui/button"

export default function AdminDashboardError({ reset }: Readonly<{ reset: () => void }>) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => headingRef.current?.focus(), [])

  return (
    <main
      aria-live="assertive"
      className="grid min-h-[100dvh] place-items-center px-4 text-center"
      role="alert"
    >
      <div className="grid w-full max-w-sm gap-4">
        <h1 className="m-0 text-2xl font-bold text-primary" ref={headingRef} tabIndex={-1}>
          관리자 운영 현황을 불러오지 못했습니다
        </h1>
        <p className="m-0 text-secondary">잠시 후 다시 시도해 주세요.</p>
        <Button onClick={reset}>다시 시도</Button>
      </div>
    </main>
  )
}
