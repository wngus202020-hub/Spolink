"use client"

import { ArrowRight } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { SupabaseConfigError } from "@/lib/supabase/env"
import { focusFirstInvalidField, GENERIC_SIGNUP_ERROR, useHydrated } from "./auth-client-routes"
import { AuthAlert, AuthTextField } from "./auth-fields"

type SignupErrors = Readonly<{
  email?: string
  form?: string
  password?: string
  passwordConfirmation?: string
}>

type SignupProviderError = Readonly<{
  code: string | undefined
  message: string
}>

export function SignupForm() {
  const hydrated = useHydrated()
  const router = useRouter()
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmationRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)
  const [errors, setErrors] = useState<SignupErrors>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    focusFirstInvalidField(
      [
        { name: "email", ref: emailRef },
        { name: "password", ref: passwordRef },
        { name: "passwordConfirmation", ref: confirmationRef },
      ],
      errors,
    )
  }, [errors])

  async function submitSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current) return

    const form = new FormData(event.currentTarget)
    const email = String(form.get("email") ?? "").trim()
    const password = String(form.get("password") ?? "")
    const passwordConfirmation = String(form.get("passwordConfirmation") ?? "")
    const validationErrors = validateSignup(email, password, passwordConfirmation)

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      focusFirstInvalidField(
        [
          { name: "email", ref: emailRef },
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

    try {
      const supabase = createSupabaseBrowserClient()
      const signup = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      })
      if (signup.error) {
        failSignup(signup.error)
        return
      }

      router.replace(signup.data.session ? "/onboarding/profile" : "/auth/check-email")
    } catch (error) {
      failSignup(error instanceof SupabaseConfigError ? error : undefined)
      return
    }
  }

  function failSignup(error?: SignupProviderError | SupabaseConfigError) {
    submittingRef.current = false
    setSubmitting(false)
    const mappedError = mapSignupProviderError(error)
    setErrors(mappedError)
  }

  return (
    <form className="space-y-5" method="post" noValidate onSubmit={submitSignup}>
      {errors.form ? <AuthAlert tone="error">{errors.form}</AuthAlert> : null}
      <AuthTextField
        autoComplete="email"
        error={errors.email}
        helperText="이메일 확인 후 필요한 정보만 단계별로 입력해요."
        id="signup-email"
        inputMode="email"
        inputRef={emailRef}
        label="이메일"
        name="email"
        type="email"
      />
      <AuthTextField
        autoComplete="new-password"
        error={errors.password}
        helperText="8자 이상 16자 이하로 입력하면 돼요."
        id="signup-password"
        inputRef={passwordRef}
        label="비밀번호"
        name="password"
        type="password"
      />
      <AuthTextField
        autoComplete="new-password"
        error={errors.passwordConfirmation}
        id="signup-password-confirmation"
        inputRef={confirmationRef}
        label="비밀번호 확인"
        name="passwordConfirmation"
        type="password"
      />
      <Button className="w-full" disabled={!hydrated || submitting} type="submit">
        계정 만들기
        <ArrowRight aria-hidden="true" className="size-4" />
      </Button>
      <p className="text-sm text-secondary">
        이미 계정이 있다면{" "}
        <Link className="font-bold text-primary" href="/auth/login">
          로그인
        </Link>
      </p>
    </form>
  )
}

function mapSignupProviderError(
  error: SignupProviderError | SupabaseConfigError | undefined,
): SignupErrors {
  if (error instanceof SupabaseConfigError) {
    return { form: "회원가입 서버 연결이 준비되지 않았어요. 잠시 후 다시 시도해요." }
  }

  const code = error?.code
  const message = error?.message?.toLowerCase() ?? ""

  if (
    code === "user_already_exists" ||
    code === "email_exists" ||
    message.includes("cannot be created again")
  ) {
    return { email: "이미 가입된 이메일이에요. 로그인하거나 다른 이메일을 입력해요." }
  }
  if (code === "invalid_email" || message.includes("invalid email")) {
    return { email: "올바른 이메일을 입력해요." }
  }
  if (code === "weak_password" || message.includes("password")) {
    return { password: "비밀번호는 8자 이상 16자 이하로 입력하면 돼요." }
  }

  return { form: GENERIC_SIGNUP_ERROR }
}

function validateSignup(
  email: string,
  password: string,
  passwordConfirmation: string,
): SignupErrors {
  const errors: { email?: string; password?: string; passwordConfirmation?: string } = {}
  if (!email.includes("@")) errors.email = "올바른 이메일을 입력해요."
  if (password.length < 8 || password.length > 16) {
    errors.password = "비밀번호는 8자 이상 16자 이하로 입력하면 돼요."
  }
  if (password !== passwordConfirmation) {
    errors.passwordConfirmation = "비밀번호가 일치하지 않아요."
  }
  return errors
}
