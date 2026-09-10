import { KeyRound, LogOut, Mail, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { AccountDeletionPanel } from "@/components/account/account-deletion-panel"
import { PublicHeader } from "@/components/layout/public-header"
import { buttonClassName } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/status-badge"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import { createSupabaseServerComponentClient } from "@/lib/auth/server-profile"

export const dynamic = "force-dynamic"
export const revalidate = 0

const roleLabels = {
  admin: "관리자",
  coach: "지도자",
  learner: "학습자",
} as const

export default async function AccountSettingsPage() {
  const auth = await readPageAuthProfile()
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured") {
    redirect("/auth/login?next=/mypage/settings")
  }
  if (auth.kind === "profile_required") redirect("/onboarding/profile")

  const supabase = await createSupabaseServerComponentClient()
  const claims = await supabase.auth.getClaims()
  const email = typeof claims.data?.claims.email === "string" ? claims.data.claims.email : null

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />

      <section className="mx-auto grid w-full max-w-[760px] gap-9 px-4 pb-14 pt-8 md:px-6 md:pt-12">
        <div className="grid gap-2">
          <StatusBadge tone="neutral">계정 관리</StatusBadge>
          <h1 className="m-0 text-[34px] font-bold leading-[1.18] text-primary">계정 설정</h1>
          <p className="m-0 max-w-[62ch] text-sm leading-[1.65] text-secondary">
            로그인 정보와 계정 상태를 확인하고 보안 관련 작업을 관리해요.
          </p>
        </div>

        <section aria-labelledby="login-info-heading" className="grid gap-5">
          <div className="grid gap-1">
            <h2
              className="m-0 text-[24px] font-bold leading-[1.3] text-primary"
              id="login-info-heading"
            >
              로그인 정보
            </h2>
            <p className="m-0 text-sm leading-[1.6] text-secondary">
              현재 로그인에 사용하는 계정 정보예요.
            </p>
          </div>

          <dl className="m-0 divide-y divide-line border-y border-line">
            <div className="grid gap-2 py-5 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
              <dt className="inline-flex items-center gap-2 text-sm font-bold text-primary">
                <Mail aria-hidden="true" className="size-4 text-accent" strokeWidth={1.8} />
                이메일
              </dt>
              <dd className="m-0 break-all text-sm text-secondary" data-account-email>
                {email ?? "이메일 정보를 확인할 수 없어요."}
              </dd>
            </div>
            <div className="grid gap-2 py-5 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
              <dt className="inline-flex items-center gap-2 text-sm font-bold text-primary">
                <ShieldCheck aria-hidden="true" className="size-4 text-accent" strokeWidth={1.8} />
                계정 상태
              </dt>
              <dd className="m-0 flex flex-wrap items-center gap-2 text-sm text-secondary">
                <StatusBadge tone="success">이용 가능</StatusBadge>
                <span>{roleLabels[auth.profile.role]}</span>
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="security-heading" className="grid gap-5">
          <div className="grid gap-1">
            <h2
              className="m-0 text-[24px] font-bold leading-[1.3] text-primary"
              id="security-heading"
            >
              보안
            </h2>
            <p className="m-0 text-sm leading-[1.6] text-secondary">
              비밀번호를 재설정하거나 현재 기기에서 로그아웃할 수 있어요.
            </p>
          </div>

          <div className="grid gap-5 border-y border-line py-5 sm:grid-cols-2">
            <div className="grid content-between gap-4">
              <div className="grid gap-1">
                <strong className="inline-flex items-center gap-2 text-sm text-primary">
                  <KeyRound aria-hidden="true" className="size-4 text-accent" strokeWidth={1.8} />
                  비밀번호
                </strong>
                <span className="text-sm leading-[1.6] text-secondary">
                  가입한 이메일로 안전한 재설정 링크를 받아요.
                </span>
              </div>
              <Link className={buttonClassName("outline", "w-fit")} href="/auth/reset-password">
                비밀번호 재설정
              </Link>
            </div>

            <div className="grid content-between gap-4 border-t border-line pt-5 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
              <div className="grid gap-1">
                <strong className="inline-flex items-center gap-2 text-sm text-primary">
                  <LogOut aria-hidden="true" className="size-4 text-accent" strokeWidth={1.8} />
                  로그아웃
                </strong>
                <span className="text-sm leading-[1.6] text-secondary">
                  현재 브라우저의 로그인 상태를 종료해요.
                </span>
              </div>
              <form action="/auth/logout" method="post">
                <button className={buttonClassName("outline", "w-fit")} type="submit">
                  로그아웃
                </button>
              </form>
            </div>
          </div>
        </section>

        <AccountDeletionPanel />
      </section>
    </main>
  )
}
