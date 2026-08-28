"use client"

import { Button } from "@/components/ui/button"

export default function CoachLessonsError({ reset }: Readonly<{ reset: () => void }>) {
  return (
    <main className="mx-auto grid min-h-[100dvh] w-full max-w-[880px] content-center gap-4 px-4 py-12 md:px-6">
      <h1 className="m-0 text-3xl font-bold text-primary">레슨 정보를 불러오지 못했습니다.</h1>
      <p className="m-0 text-base leading-7 text-secondary">
        연결 상태를 확인한 뒤 다시 시도해 주세요.
      </p>
      <Button className="w-fit" onClick={reset}>
        다시 시도
      </Button>
    </main>
  )
}
