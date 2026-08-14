import { MailCheck } from "lucide-react"
import Link from "next/link"
import { AuthAlert } from "@/components/auth/auth-fields"
import { AuthShell } from "@/components/auth/auth-shell"

export default function CheckEmailPage() {
  return (
    <AuthShell
      description="메일의 인증 링크를 열면 SPOLINK 프로필 설정으로 이어져요."
      eyebrow="이메일 확인"
      icon={MailCheck}
      title="이메일을 확인해요."
    >
      <div className="space-y-5">
        <AuthAlert tone="success">
          가입 메일을 보냈어요. 받은 편지함에서 인증 링크를 확인해요.
        </AuthAlert>
        <Link className="inline-flex text-sm font-bold text-primary" href="/auth/login">
          로그인으로 돌아가기
        </Link>
      </div>
    </AuthShell>
  )
}
