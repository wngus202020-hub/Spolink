import { UserPlus } from "lucide-react"
import { AuthShell } from "@/components/auth/auth-shell"
import { SignupForm } from "@/components/auth/signup-form"

export default function SignupPage() {
  return (
    <AuthShell
      description="프로필과 선택 동의는 이메일 확인 뒤 온보딩에서 이어져요."
      eyebrow="회원가입"
      icon={UserPlus}
      title="이메일로 SPOLINK 계정을 만들어요."
    >
      <SignupForm />
    </AuthShell>
  )
}
