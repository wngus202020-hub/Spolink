import { KeyRound } from "lucide-react"
import { AuthShell } from "@/components/auth/auth-shell"
import { UpdatePasswordForm } from "@/components/auth/update-password-form"
import { requireUpdatePasswordPageAccess } from "@/lib/auth/update-password-page"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function UpdatePasswordPage() {
  await requireUpdatePasswordPageAccess()

  return (
    <AuthShell
      description="메일 링크로 확인된 세션에서만 새 비밀번호를 저장할 수 있어요."
      eyebrow="새 비밀번호"
      icon={KeyRound}
      title="새 비밀번호를 입력해요."
    >
      <UpdatePasswordForm />
    </AuthShell>
  )
}
