"use client"

import { ArrowRight, ShieldCheck } from "lucide-react"
import { useRouter } from "next/navigation"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { createBookingReservation } from "@/lib/reservations/booking-request-client"

type BookingRequestFormProps = Readonly<{
  lessonId: string
  lessonScheduleId: string
  priceText: string
  returnPath: string
}>

export function BookingRequestForm({
  lessonId,
  lessonScheduleId,
  priceText,
  returnPath,
}: BookingRequestFormProps) {
  const router = useRouter()
  const alertRef = useRef<HTMLParagraphElement>(null)
  const submittingRef = useRef(false)
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (message) alertRef.current?.focus()
  }, [message])

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current) return

    submittingRef.current = true
    setSubmitting(true)
    setMessage(null)

    const result = await createBookingReservation({ lessonId, lessonScheduleId })
    if (result.status === "success") {
      router.push(result.paymentHref)
      return
    }
    if (result.code === "UNAUTHORIZED") {
      router.push(`/auth/login?next=${returnPath}`)
      return
    }
    if (result.code === "PROFILE_REQUIRED") {
      router.push("/onboarding/profile")
      return
    }

    submittingRef.current = false
    setSubmitting(false)
    setMessage(result.message)
  }

  return (
    <form aria-busy={submitting} className="grid gap-4" method="post" onSubmit={submitBooking}>
      <input name="lessonId" type="hidden" value={lessonId} />
      <input name="lessonScheduleId" type="hidden" value={lessonScheduleId} />

      {message ? (
        <p
          className="m-0 rounded-[var(--radius-md)] border border-[var(--status-error)] bg-canvas px-4 py-3 text-sm font-bold leading-[1.55] text-[var(--status-error)]"
          ref={alertRef}
          role="alert"
          tabIndex={-1}
        >
          {message}
        </p>
      ) : null}

      <Button className="w-full" disabled={submitting} type="submit">
        {submitting ? "예약 요청 중" : "예약 요청"}
        <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
      </Button>

      <p aria-live="polite" className="m-0 grid gap-1 text-sm leading-[1.6] text-secondary">
        <span className="inline-flex items-start gap-2">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
          <span>서버 확인 후 결제 대기 예약 생성</span>
        </span>
        <span>결제 화면에서 {priceText}을 다시 확인해요.</span>
      </p>
    </form>
  )
}
