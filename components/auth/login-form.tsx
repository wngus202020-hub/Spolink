"use client"

import { ArrowRight, ShieldAlert } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { type FormEvent, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import {
  focusFirstInvalidField,
  GENERIC_AUTH_ERROR,
  readSafeNextFromLocation,
  resolveProfileDestination,
  useHydrated,
} from "./auth-client-routes"
import { AuthAlert, AuthTextField } from "./auth-fields"

type LoginFormProps = Readonly<{
  restrictedMessage?: string | undefined
}>

type LoginErrors = Readonly<{
  email?: string
  form?: string
  password?: string
}>

export function LoginForm({ restrictedMessage }: LoginFormProps) {
  const hydrated = useHydrated()
  const router = useRouter()
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)
  const [errors, setErrors] = useState<LoginErrors>({})
  const [submitting, setSubmitting] = useState(false)

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current) return

    const form = new FormData(event.currentTarget)
    const email = String(form.get("email") ?? "").trim()
    const password = String(form.get("password") ?? "")
    const nextPath = readSafeNextFromLocation("/lessons")
    const validationErrors = validateLogin(email, password)

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      focusFirstInvalidField(
        [
          { name: "email", ref: emailRef },
          { name: "password", ref: passwordRef },
        ],
        validationErrors,
      )
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    setErrors({})

    const supabase = createSupabaseBrowserClient()
    const signIn = await supabase.auth.signInWithPassword({ email, password })
    if (signIn.error) {
      failLogin()
      return
    }

    const profileResponse = await fetch("/api/me", {
      cache: "no-store",
      credentials: "same-origin",
    })
    const destination = await resolveProfileDestination(profileResponse, nextPath)
    if (destination.kind === "error") {
      failLogin(destination.message)
      return
    }
    if (destination.kind === "account-deleted" || destination.kind === "account-suspended") {
      await supabase.auth.signOut()
    }
    router.replace(destination.href)
  }

  function failLogin(message = GENERIC_AUTH_ERROR) {
    submittingRef.current = false
    setSubmitting(false)
    setErrors({ form: message })
  }

  return (
    <form className="space-y-5" method="post" noValidate onSubmit={submitLogin}>
      <div className="space-y-3">
        {restrictedMessage ? (
          <AuthAlert tone="error">
            <span className="inline-flex items-start gap-2">
              <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{restrictedMessage}</span>
            </span>
          </AuthAlert>
        ) : null}
        {errors.form ? <AuthAlert tone="error">{errors.form}</AuthAlert> : null}
      </div>
      <AuthTextField
        autoComplete="email"
        error={errors.email}
        helperText="가입할 때 사용한 이메일을 입력해요."
        id="login-email"
        inputMode="email"
        inputRef={emailRef}
        label="이메일"
        name="email"
        type="email"
      />
      <AuthTextField
        autoComplete="current-password"
        error={errors.password}
        helperText="계정에 설정한 비밀번호를 입력해요."
        id="login-password"
        inputRef={passwordRef}
        label="비밀번호"
        name="password"
        type="password"
      />
      <Button className="w-full" disabled={!hydrated || submitting} type="submit">
        로그인
        <ArrowRight aria-hidden="true" className="size-4" />
      </Button>
      <div className="flex flex-wrap justify-between gap-3 text-sm text-secondary">
        <Link className="font-bold text-primary" href="/auth/signup">
          회원가입
        </Link>
        <Link className="font-bold text-primary" href="/auth/reset-password">
          비밀번호 재설정
        </Link>
      </div>
    </form>
  )
}

function validateLogin(email: string, password: string): LoginErrors {
  const errors: { email?: string; password?: string } = {}
  if (!email.includes("@")) errors.email = "올바른 이메일을 입력해요."
  if (password.length === 0) errors.password = "비밀번호를 입력해요."
  return errors
}
