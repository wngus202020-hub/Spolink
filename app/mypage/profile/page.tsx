import { redirect } from "next/navigation"
import { PublicHeader } from "@/components/layout/public-header"
import { ProfileEditForm } from "@/components/profile/profile-edit-form"
import { readPageAuthProfile } from "@/lib/auth/page-auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function ProfileEditPage() {
  const auth = await readPageAuthProfile()
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured") {
    redirect("/auth/login?next=/mypage/profile")
  }
  if (auth.kind === "profile_required") {
    redirect("/onboarding/profile")
  }

  const initialProfile = {
    displayName: auth.profile.display_name,
    realName: auth.profile.real_name,
    phone: auth.profile.phone,
    defaultRegion: auth.profile.default_region,
    locationAgreed: auth.profile.location_agreed_at !== null,
    marketingAgreed: auth.profile.marketing_agreed_at !== null,
  }

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />

      <section className="mx-auto grid w-full max-w-[760px] gap-7 px-4 pb-14 pt-8 md:px-6 md:pt-12">
        <div className="grid gap-2">
          <p className="m-0 text-sm font-bold text-accent">내 정보</p>
          <h1 className="m-0 text-[34px] font-bold leading-[1.18] text-primary">프로필 수정</h1>
          <p className="m-0 text-sm leading-[1.6] text-secondary">
            현재 등록된 정보를 확인하고 관리할 수 있어요.
          </p>
        </div>

        <section
          aria-labelledby="profile-current-state"
          className="grid gap-5 rounded-[var(--radius-xl)] border border-line bg-canvas p-5 [box-shadow:var(--shadow-panel)] md:p-6"
          data-profile-edit-shell
        >
          <div className="grid gap-1">
            <h2
              className="m-0 text-[22px] font-bold leading-[1.36] text-primary"
              id="profile-current-state"
            >
              수정할 정보
            </h2>
            <p className="m-0 text-sm leading-[1.6] text-secondary">
              저장 시 변경된 항목만 안전하게 반영해요.
            </p>
          </div>

          <ProfileEditForm initialProfile={initialProfile} />
        </section>
      </section>
    </main>
  )
}
