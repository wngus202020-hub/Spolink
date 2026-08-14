import { ShieldCheck } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { CoachApplicationForm } from "@/components/coach/coach-application-form"
import { PublicHeader } from "@/components/layout/public-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import { createSupabaseServerComponentClient } from "@/lib/auth/server-profile"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function CoachApplyPage() {
  const auth = await readPageAuthProfile()
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured") {
    redirect("/auth/login?next=/coach/apply")
  }
  if (auth.kind === "profile_required") redirect("/onboarding/profile")

  const supabase = await createSupabaseServerComponentClient()
  const { data: sports } = await supabase
    .from("sports")
    .select("id,name")
    .eq("is_active", true)
    .order("name", { ascending: true })

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />
      <section className="mx-auto grid w-full max-w-[1120px] gap-8 px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <div className="grid gap-4">
          <StatusBadge tone="neutral">지도자 등록</StatusBadge>
          <div className="grid gap-3">
            <h1 className="m-0 text-pretty text-[34px] font-bold leading-[1.18] text-primary md:text-5xl md:leading-[1.14]">
              지도자 인증 신청
            </h1>
            <p className="m-0 max-w-[68ch] text-base leading-[1.7] text-secondary md:text-lg">
              자격과 활동 정보를 저장하고 비공개 자격 증빙을 등록해요.
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-line bg-subtle p-4 text-sm leading-[1.6] text-secondary">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />
            <p className="m-0 break-keep">
              제출 전까지 신청서를 수정할 수 있어요. 심사&nbsp;중이거나 승인·정지 상태인 신청서는
              읽기&nbsp;전용으로 표시돼요.
            </p>
          </div>
        </div>

        <section
          aria-labelledby="account-profile-heading"
          className="grid gap-4 border-b border-line pb-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="m-0 text-2xl font-bold text-primary" id="account-profile-heading">
                계정 정보 요약
              </h2>
              <p className="m-0 mt-1 text-sm text-secondary">
                실명과 연락처는 계정 프로필에서 관리돼요.
              </p>
            </div>
            <Link
              className="inline-flex min-h-11 items-center rounded-[var(--radius-md)] border border-line px-4 py-2 text-sm font-bold text-primary hover:bg-inset"
              href="/onboarding/profile"
            >
              프로필 정보 확인
            </Link>
          </div>
          <dl className="m-0 grid gap-4 sm:grid-cols-2">
            <Summary label="이름" value={auth.profile.real_name ?? auth.profile.display_name} />
            <Summary label="연락처" value={auth.profile.phone ?? "프로필에서 확인 필요"} />
          </dl>
        </section>

        <CoachApplicationForm sports={sports ?? []} />
      </section>
    </main>
  )
}

function Summary({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm font-bold text-primary">{label}</dt>
      <dd className="m-0 text-sm text-secondary">{value}</dd>
    </div>
  )
}
