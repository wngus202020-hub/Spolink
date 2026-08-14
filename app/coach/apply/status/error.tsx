"use client"

import { AlertCircle } from "lucide-react"
import { useEffect, useRef } from "react"

import { Button } from "@/components/ui/button"

export default function CoachApplicationStatusError({
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <main className="grid min-h-[100dvh] place-items-center px-4 py-8">
      <section className="grid w-full max-w-[560px] gap-5 rounded-[var(--radius-xl)] border border-line bg-canvas p-6 [box-shadow:var(--shadow-panel)]">
        <AlertCircle aria-hidden="true" className="size-8 text-[var(--status-error)]" />
        <div className="grid gap-2">
          <h1
            className="m-0 text-2xl font-bold text-primary focus:outline-2 focus:outline-offset-2 focus:outline-primary"
            ref={headingRef}
            tabIndex={-1}
          >
            신청 상태를 불러오지 못했어요.
          </h1>
          <p className="m-0 break-keep text-sm leading-[1.7] text-secondary">
            잠시 후 다시 시도해요. 문제가 계속되면 고객센터로 문의해 주세요.
          </p>
        </div>
        <div>
          <Button onClick={reset}>다시 시도</Button>
        </div>
      </section>
    </main>
  )
}
