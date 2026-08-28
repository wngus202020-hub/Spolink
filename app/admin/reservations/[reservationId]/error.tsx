"use client"

import { useEffect, useRef } from "react"

import { Button } from "@/components/ui/button"

export default function AdminReservationError({ reset }: Readonly<{ reset: () => void }>) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => headingRef.current?.focus(), [])

  return (
    <main
      className="grid min-h-[60dvh] place-items-center px-4 text-center"
      aria-live="assertive"
      role="alert"
    >
      <div className="grid max-w-sm gap-4">
        <h1 className="m-0 text-2xl font-bold text-primary" ref={headingRef} tabIndex={-1}>
          예약 운영 상세를 불러오지 못했습니다
        </h1>
        <p className="m-0 text-secondary">잠시 후 다시 시도해 주세요.</p>
        <Button onClick={reset}>다시 시도</Button>
      </div>
    </main>
  )
}
