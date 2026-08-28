"use client"

import { Button } from "@/components/ui/button"

export default function AdminLessonsError({ reset }: Readonly<{ reset: () => void }>) {
  return (
    <main className="grid min-h-[60dvh] place-items-center px-4 text-center">
      <div className="grid max-w-sm gap-4">
        <h1 className="m-0 text-2xl font-bold text-primary">검토 목록을 불러오지 못했습니다</h1>
        <p className="m-0 text-sm text-secondary">잠시 후 다시 시도해 주세요.</p>
        <Button onClick={reset}>다시 시도</Button>
      </div>
    </main>
  )
}
