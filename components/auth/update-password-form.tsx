"use client"

import { ArrowRight } from "lucide-react"
import { useRouter } from "next/navigation"
import { type FormEvent, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  focusFirstInvalidField,
  RECOVERY_REQUIRED_MESSAGE,
  resolveProfileDestination,
  useHydrated,
} from "./auth-client-routes"
import { AuthAlert, AuthTextField } from "./auth-fields"

type UpdateErrors = Readonly<{
  form?: string
  password?: string
  passwordConfirmation?: string
}>

export function UpdatePasswordForm() {
  const hydrated = useHydrated()
  const router = useRouter()
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmationRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)
  const [errors, setErrors] = useState<UpdateErrors>({})
  const [submitting, setSubmitting] = useState(false)

  async function submitUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current) return

    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const password = String(form.get("password") ?? "")
    const passwordConfirmation = String(form.get("passwordConfirmation") ?? "")
    const validationErrors = validateUpdate(password, passwordConfirmation)

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      focusFirstInvalidField(
        [
          { name: "password", ref: passwordRef },
          { name: "passwordConfirmation", ref: confirmationRef },
        ],
        validationErrors,
      )
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    setErrors({})

    const response = await fetch("/auth/update-password/submit", {
      body: JSON.stringify({ password, passwordConfirmation }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })

    if (!response.ok) {
      formElement.reset()
      router.replace("/auth/reset-password?error=recovery-required")
      return
    }

    const profileResponse = await fetch("/api/me", {
      cache: "no-store",
      credentials: "same-origin",
    })
    const destination = await resolveProfileDestination(profileResponse, "/lessons")
    if (destination.kind === "error") {
      submittingRef.current = false
      setSubmitting(false)
      setErrors({ form: RECOVERY_REQUIRED_MESSAGE })
      return
    }
    router.replace(destination.href)
  }

  return (
    <form className="space-y-5" method="post" noValidate onSubmit={submitUpdate}>
      {errors.form ? <AuthAlert tone="error">{errors.form}</AuthAlert> : null}
      <AuthTextField
        autoComplete="new-password"
        error={errors.password}
        helperText="8자 이상 72자 이하로 입력하면 돼요."
        id="update-password"
        inputRef={passwordRef}
        label="새 비밀번호"
        name="password"
        type="password"
      />
      <AuthTextField
        autoComplete="new-password"
        error={errors.passwordConfirmation}
        id="update-password-confirmation"
        inputRef={confirmationRef}
        label="새 비밀번호 확인"
        name="passwordConfirmation"
        type="password"
      />
      <Button className="w-full" disabled={!hydrated || submitting} type="submit">
        비밀번호 변경
        <ArrowRight aria-hidden="true" className="size-4" />
      </Button>
    </form>
  )
}

function validateUpdate(password: string, passwordConfirmation: string): UpdateErrors {
  const errors: { password?: string; passwordConfirmation?: string } = {}
  if (password.length < 8 || password.length > 72) {
    errors.password = "비밀번호는 8자 이상 72자 이하로 입력하면 돼요."
  }
  if (password !== passwordConfirmation) {
    errors.passwordConfirmation = "비밀번호가 일치하지 않아요."
  }
  return errors
}
