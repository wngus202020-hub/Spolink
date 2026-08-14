import { KeyRound } from "lucide-react"
import { AuthShell } from "@/components/auth/auth-shell"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"

type ResetPasswordPageProps = Readonly<{
  searchParams?: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>
}>

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams

  return (
    <AuthShell
      description="가입한 이메일로 재설정 안내를 보내드려요."
      eyebrow="비밀번호 재설정"
      icon={KeyRound}
      title="비밀번호를 다시 설정해요."
    >
      <ResetPasswordForm recoveryRequired={readFirst(params?.["error"]) === "recovery-required"} />
    </AuthShell>
  )
}

function readFirst(value: string | readonly string[] | undefined): string | null {
  if (typeof value === "string") return value
  return value?.[0] ?? null
}
