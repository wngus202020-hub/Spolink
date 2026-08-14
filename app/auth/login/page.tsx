import { LogIn } from "lucide-react"
import { AuthShell } from "@/components/auth/auth-shell"
import { LoginForm } from "@/components/auth/login-form"

type LoginPageProps = Readonly<{
  searchParams?: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>
}>

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  const error = readFirst(params?.["error"])

  return (
    <AuthShell
      description="가까운 레슨 예약과 지도자 활동을 안전하게 이어가기 위해 이메일 계정으로 로그인해요."
      eyebrow="이메일 로그인"
      icon={LogIn}
      title="다시 운동을 시작할 시간이에요."
    >
      <LoginForm restrictedMessage={restrictedMessage(error)} />
    </AuthShell>
  )
}

function restrictedMessage(error: string | null): string | undefined {
  switch (error) {
    case "account-deleted":
      return "탈퇴 처리된 계정이에요."
    case "account-suspended":
      return "현재 이용이 제한된 계정이에요."
    case "auth-link-invalid":
      return "인증 링크가 유효하지 않아요. 다시 시도해요."
    case "auth-not-configured":
      return "인증 환경을 확인한 뒤 다시 시도해요."
    default:
      return undefined
  }
}

function readFirst(value: string | readonly string[] | undefined): string | null {
  if (typeof value === "string") return value
  return value?.[0] ?? null
}
