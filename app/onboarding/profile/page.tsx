import { UserRoundCheck } from "lucide-react"
import { redirect } from "next/navigation"
import { AuthShell } from "@/components/auth/auth-shell"
import { ProfileOnboardingForm } from "@/components/onboarding/profile-onboarding-form"
import { readPageAuthProfile } from "@/lib/auth/page-auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function ProfileOnboardingPage() {
  const auth = await readPageAuthProfile()
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured") {
    redirect("/auth/login?next=/onboarding/profile")
  }
  if (auth.kind === "ready") redirect("/lessons")

  return (
    <AuthShell
      description="필수 정보를 입력한 뒤 레슨을 찾거나 지도자 등록을 이어갈 수 있어요."
      eyebrow="계정 생성의 마지막 단계"
      icon={UserRoundCheck}
      title={
        <>
          프로필 설정을 <span className="whitespace-nowrap">마쳐요.</span>
        </>
      }
    >
      <ProfileOnboardingForm />
    </AuthShell>
  )
}
