"use client"

import { Star } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"

export function ReviewForm({ reservationId }: Readonly<{ reservationId: string }>) {
  const [rating, setRating] = useState(5)
  const [content, setContent] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setMessage(null)
    try {
      const response = await fetch("/api/reviews", {
        body: JSON.stringify({ content, rating, reservationId }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Origin: window.location.origin },
        method: "POST",
      })
      setMessage(
        response.ok ? "후기를 등록했어요." : "후기를 등록하지 못했어요. 예약 상태를 확인해 주세요.",
      )
      if (response.ok) setContent("")
    } catch {
      setMessage("잠시 후 다시 시도해 주세요.")
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className="grid max-w-2xl gap-5 rounded-[var(--radius-xl)] border border-line bg-canvas p-5 [box-shadow:var(--shadow-panel)] md:p-6"
      onSubmit={submit}
    >
      <fieldset className="grid gap-3 border-0 p-0">
        <legend className="text-base font-bold text-primary">별점 선택</legend>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              aria-label={`${value}점`}
              aria-pressed={rating === value}
              className="inline-flex size-11 items-center justify-center rounded-[var(--radius-md)] border border-line"
              key={value}
              onClick={() => setRating(value)}
              type="button"
            >
              <Star
                aria-hidden="true"
                className={value <= rating ? "fill-accent text-accent" : "text-tertiary"}
              />
            </button>
          ))}
        </div>
      </fieldset>
      <label className="grid gap-2 text-sm font-bold text-primary" htmlFor="review-content">
        수업 후기
        <textarea
          className="min-h-40 rounded-[var(--radius-md)] border border-line bg-canvas p-3 font-normal leading-relaxed text-primary outline-none focus:border-accent"
          id="review-content"
          maxLength={2000}
          onChange={(event) => setContent(event.target.value)}
          placeholder="수업에서 좋았던 점을 남겨 주세요."
          required
          value={content}
        />
      </label>
      <Button disabled={pending} type="submit">
        {pending ? "등록 중..." : "후기 등록"}
      </Button>
      {message ? (
        <p aria-live="polite" className="m-0 text-sm text-secondary" role="status">
          {message}
        </p>
      ) : null}
    </form>
  )
}
