"use client"

import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react"
import { useRouter } from "next/navigation"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { type PreparedPayment, preparePayment } from "@/lib/payments/payment-prepare-client"

type PaymentPreparationFormProps = Readonly<{
  initialPayment?: PreparedPayment | null
  reservationId: string
  returnPath: string
}>

export function PaymentPreparationForm({
  initialPayment = null,
  reservationId,
  returnPath,
}: PaymentPreparationFormProps) {
  const router = useRouter()
  const alertRef = useRef<HTMLParagraphElement>(null)
  const submittingRef = useRef(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [preparedPayment, setPreparedPayment] = useState<PreparedPayment | null>(initialPayment)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (errorMessage) alertRef.current?.focus()
  }, [errorMessage])

  async function submitPreparation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current) return

    submittingRef.current = true
    setSubmitting(true)
    setErrorMessage(null)

    const result = await preparePayment(reservationId)
    if (result.status === "success") {
      submittingRef.current = false
      setSubmitting(false)
      setPreparedPayment(result.payment)
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
    setErrorMessage(result.message)
  }

  return (
    <form aria-busy={submitting} className="grid gap-4" method="post" onSubmit={submitPreparation}>
      {errorMessage ? (
        <p
          className="m-0 rounded-[var(--radius-md)] border border-[var(--status-error)] bg-canvas px-4 py-3 text-sm font-bold leading-[1.55] text-[var(--status-error)]"
          ref={alertRef}
          role="alert"
          tabIndex={-1}
        >
          {errorMessage}
        </p>
      ) : null}

      <div aria-live="polite" className="grid gap-4">
        {preparedPayment ? (
          <section className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--status-warning)] bg-canvas p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-[var(--status-warning)]"
                strokeWidth={1.8}
              />
              <div className="grid gap-1">
                <strong className="text-base text-primary">결제 요청 준비됨</strong>
                <span className="text-sm leading-[1.6] text-secondary">
                  결제 요청 정보만 준비됐어요. 아직 결제 승인이나 예약 상태 변경은 이루어지지
                  않았어요.
                </span>
              </div>
            </div>
            <div className="grid gap-1 border-t border-line pt-3 text-sm text-secondary">
              <span>{preparedPayment.orderName}</span>
              <strong className="text-base text-primary">
                {preparedPayment.amount.toLocaleString("ko-KR")}원
              </strong>
            </div>
          </section>
        ) : null}

        {submitting ? (
          <p className="m-0 text-sm font-bold text-secondary">결제 요청 정보를 준비하고 있어요.</p>
        ) : null}

        <Button className="w-full whitespace-nowrap" disabled={submitting} type="submit">
          {submitting ? "준비 중" : preparedPayment ? "준비 정보 다시 확인" : "결제 요청 준비"}
          <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
        </Button>
      </div>

      <p className="m-0 inline-flex items-start gap-2 text-sm leading-[1.6] text-secondary">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
        <span>
          현재 단계에서는 안전한 결제 요청 정보만 준비하며, 결제 수단 연결은 제공하지 않아요.
        </span>
      </p>
    </form>
  )
}
