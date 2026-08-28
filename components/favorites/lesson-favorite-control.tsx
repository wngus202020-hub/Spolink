"use client"

import { Heart, HeartOff } from "lucide-react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { mutateFavorite } from "@/lib/favorites/mutation-client"

export function LessonFavoriteControl({ lessonId }: Readonly<{ lessonId: string }>) {
  const [favorited, setFavorited] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const messageRef = useRef<HTMLParagraphElement>(null)

  async function toggle() {
    if (pending) return
    setPending(true)
    setMessage(null)
    const result = await mutateFavorite(favorited ? "remove" : "add", lessonId)
    setPending(false)
    if (result.status === "failure") {
      setMessage(result.message)
      requestAnimationFrame(() => messageRef.current?.focus())
      return
    }
    setFavorited(result.favorited)
    setMessage(result.favorited ? "찜한 레슨에 저장했어요." : "찜을 해제했어요.")
  }

  return (
    <div className="grid gap-2">
      <Button
        aria-busy={pending}
        disabled={pending}
        onClick={() => void toggle()}
        variant="outline"
      >
        {favorited ? (
          <HeartOff aria-hidden="true" className="size-4" />
        ) : (
          <Heart aria-hidden="true" className="size-4" />
        )}
        {pending ? "처리 중…" : favorited ? "찜 해제" : "찜하기"}
      </Button>
      {message ? (
        <p
          aria-live="polite"
          className="m-0 text-sm text-secondary"
          ref={messageRef}
          role="status"
          tabIndex={-1}
        >
          {message}
        </p>
      ) : null}
    </div>
  )
}
