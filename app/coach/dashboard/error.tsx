"use client"

import { useEffect, useRef } from "react"

import { Button } from "@/components/ui/button"

type Props = Readonly<{ reset: () => void }>

export default function CoachDashboardError({ reset }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <main
      className="mx-auto grid min-h-dvh w-full max-w-3xl place-content-center gap-4 px-4 py-12"
      role="alert"
    >
      <h1 className="m-0 text-2xl font-bold text-primary" ref={headingRef} tabIndex={-1}>
        지도자 운영 현황을 불러오지 못했어요
      </h1>
      <p className="m-0 break-keep leading-relaxed text-secondary">
        잠시 후 다시 시도해 주세요. 문제가 계속되면 고객센터에 문의해 주세요.
      </p>
      <div className="pt-2">
        <Button onClick={reset}>다시 시도</Button>
      </div>
    </main>
  )
}
