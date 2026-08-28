"use client"

import { CheckCircle2, CircleAlert, Heart, RotateCcw } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { FavoriteLessonRow } from "@/components/favorites/favorite-lesson-row"
import { Button } from "@/components/ui/button"
import { mutateFavorite } from "@/lib/favorites/mutation-client"
import type { FavoriteLessonView } from "@/lib/favorites/read-model"

type MutationNotice = Readonly<
  | { kind: "added" }
  | { item: FavoriteLessonView; kind: "removed" }
  | { item: FavoriteLessonView | null; kind: "error"; message: string }
>

export function FavoriteLessonsList({
  initialItems,
}: Readonly<{ initialItems: readonly FavoriteLessonView[] }>) {
  const router = useRouter()
  const noticeRef = useRef<HTMLDivElement>(null)
  const [items, setItems] = useState(initialItems)
  const [notice, setNotice] = useState<MutationNotice | null>(null)
  const [pendingLessonId, setPendingLessonId] = useState<string | null>(null)

  useEffect(() => {
    if (notice?.kind === "error") noticeRef.current?.focus()
  }, [notice])

  async function removeFavorite(item: FavoriteLessonView) {
    if (pendingLessonId) return
    setPendingLessonId(item.lessonId)
    setNotice(null)

    const result = await mutateFavorite("remove", item.lessonId)
    setPendingLessonId(null)
    if (result.status === "failure") {
      if (result.code === "UNAUTHORIZED") {
        router.push("/auth/login?next=/mypage/favorites")
        return
      }
      if (result.code === "PROFILE_REQUIRED") {
        router.push("/onboarding/profile")
        return
      }
      setNotice({ item: null, kind: "error", message: result.message })
      return
    }

    setItems((current) => current.filter((favorite) => favorite.lessonId !== item.lessonId))
    setNotice({ item, kind: "removed" })
    router.refresh()
  }

  async function restoreFavorite(item: FavoriteLessonView) {
    if (pendingLessonId) return
    setPendingLessonId(item.lessonId)

    const result = await mutateFavorite("add", item.lessonId)
    setPendingLessonId(null)
    if (result.status === "failure") {
      setNotice({ item, kind: "error", message: result.message })
      return
    }

    setItems((current) =>
      current.some((favorite) => favorite.lessonId === item.lessonId)
        ? current
        : [item, ...current],
    )
    setNotice({ kind: "added" })
    router.refresh()
  }

  return (
    <section className="grid gap-4" aria-labelledby="favorite-lessons-heading">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div className="grid gap-1">
          <h2
            className="m-0 text-[length:var(--type-h2-size)] font-bold leading-[var(--type-h2-leading)] text-primary"
            id="favorite-lessons-heading"
          >
            저장한 레슨
          </h2>
          <p className="m-0 text-sm text-secondary">총 {items.length.toLocaleString("ko-KR")}개</p>
        </div>
        <span className="text-sm font-bold text-secondary">최근 저장순</span>
      </div>

      {notice ? (
        <MutationFeedback
          notice={notice}
          pendingLessonId={pendingLessonId}
          ref={noticeRef}
          restoreFavorite={restoreFavorite}
        />
      ) : null}

      {items.length === 0 ? <EmptyFavoritesState /> : null}

      <div className="grid gap-3">
        {items.map((favorite) => (
          <FavoriteLessonRow
            favorite={favorite}
            key={favorite.lessonId}
            pending={pendingLessonId === favorite.lessonId}
            removeFavorite={removeFavorite}
          />
        ))}
      </div>
    </section>
  )
}

function MutationFeedback({
  notice,
  pendingLessonId,
  ref,
  restoreFavorite,
}: Readonly<{
  notice: MutationNotice
  pendingLessonId: string | null
  ref: React.RefObject<HTMLDivElement | null>
  restoreFavorite: (item: FavoriteLessonView) => Promise<void>
}>) {
  const isError = notice.kind === "error"
  const item = notice.kind === "added" ? null : notice.item
  const message =
    notice.kind === "added"
      ? "찜을 다시 저장했어요."
      : notice.kind === "removed"
        ? "찜을 삭제했어요."
        : notice.message

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border bg-canvas px-4 py-3 text-sm font-bold ${
        isError
          ? "border-[var(--status-error)] text-[var(--status-error)]"
          : "border-[var(--status-success)] text-[var(--status-success)]"
      }`}
      ref={ref}
      role={isError ? "alert" : "status"}
      tabIndex={-1}
    >
      <span className="inline-flex min-w-0 items-center gap-2 leading-normal">
        {isError ? (
          <CircleAlert aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.8} />
        ) : (
          <CheckCircle2 aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.8} />
        )}
        {message}
      </span>
      {item ? (
        <Button
          aria-busy={pendingLessonId === item.lessonId}
          disabled={pendingLessonId !== null}
          onClick={() => restoreFavorite(item)}
          variant="outline"
        >
          <RotateCcw aria-hidden="true" className="size-4" strokeWidth={1.8} />
          {pendingLessonId === item.lessonId ? "복원 중" : "다시 찜하기"}
        </Button>
      ) : null}
    </div>
  )
}

function EmptyFavoritesState() {
  return (
    <div className="grid min-h-64 place-items-center rounded-[var(--radius-xl)] border border-line bg-subtle p-8 text-center">
      <div className="grid max-w-[440px] gap-3">
        <Heart aria-hidden="true" className="mx-auto size-7 text-accent" strokeWidth={1.8} />
        <h3 className="m-0 text-[length:var(--type-h2-size)] font-bold leading-[var(--type-h2-leading)] text-primary">
          아직 찜한 레슨이 없어요
        </h3>
        <p className="m-0 text-sm leading-normal text-secondary">관심 있는 레슨을 저장해 두세요.</p>
        <Link
          className="mx-auto inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] bg-accent px-5 py-3 text-sm font-bold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]"
          href="/lessons"
        >
          레슨 찾기
        </Link>
      </div>
    </div>
  )
}
