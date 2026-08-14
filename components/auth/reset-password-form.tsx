"use client"

import { MailCheck } from "lucide-react"
import Link from "next/link"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { focusFirstInvalidField, RESET_SUCCESS_MESSAGE, useHydrated } from "./auth-client-routes"
import { AuthAlert, AuthTextField } from "./auth-fields"

type ResetErrors = Readonly<{
  email?: string
}>

type ResetPasswordFormProps = Readonly<{
  recoveryRequired?: boolean
}>

const RESET_REQUEST_ERROR = "재설정 안내를 보내지 못했어요. 잠시 후 다시 시도해요."
const RESET_REQUEST_TIMEOUT_MS = 10_000

export function ResetPasswordForm({ recoveryRequired = false }: ResetPasswordFormProps) {
  const hydrated = useHydrated()
  const emailRef = useRef<HTMLInputElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const submittingRef = useRef(false)
  const [errors, setErrors] = useState<ResetErrors>({})
  const [requestFailed, setRequestFailed] = useState(false)
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (requestFailed) errorRef.current?.focus()
  }, [requestFailed])

  async function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current) return

    const form = new FormData(event.currentTarget)
    const email = String(form.get("email") ?? "").trim()
    const validationErrors = validateReset(email)

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      focusFirstInvalidField([{ name: "email", ref: emailRef }], validationErrors)
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    setErrors({})
    setRequestFailed(false)

    try {
      const response = await fetch("/auth/recovery/start", {
        body: JSON.stringify({ email }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(RESET_REQUEST_TIMEOUT_MS),
      })

      if (response.ok) setSent(true)
      else setRequestFailed(true)
    } catch {
      setRequestFailed(true)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <div className="space-y-5">
        <AuthAlert tone="success">
          <span className="inline-flex items-start gap-2">
            <MailCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{RESET_SUCCESS_MESSAGE}</span>
          </span>
        </AuthAlert>
        <Link className="inline-flex text-sm font-bold text-primary" href="/auth/login">
          로그인으로 돌아가기
        </Link>
      </div>
    )
  }

  return (
    <form className="space-y-5" method="post" noValidate onSubmit={submitReset}>
      {recoveryRequired ? (
        <AuthAlert tone="error">비밀번호 재설정 링크를 다시 요청해요.</AuthAlert>
      ) : null}
      {requestFailed ? (
        <AuthAlert alertRef={errorRef} tabIndex={-1} tone="error">
          {RESET_REQUEST_ERROR}
        </AuthAlert>
      ) : null}
      <AuthTextField
        autoComplete="email"
        error={errors.email}
        helperText="계정 보호를 위해 요청 결과는 같은 안내로 표시돼요."
        id="reset-email"
        inputMode="email"
        inputRef={emailRef}
        label="이메일"
        name="email"
        type="email"
      />
      <Button className="w-full" disabled={!hydrated || submitting} type="submit">
        재설정 안내 받기
      </Button>
      <Link className="inline-flex text-sm font-bold text-primary" href="/auth/login">
        로그인으로 돌아가기
      </Link>
    </form>
  )
}

function validateReset(email: string): ResetErrors {
  if (!email.includes("@")) return { email: "올바른 이메일을 입력해요." }
  return {}
}
