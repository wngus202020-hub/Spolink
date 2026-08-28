import { ArrowLeft, CircleAlert, Shield } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PublicHeader } from "@/components/layout/public-header"
import { TrustSafetyPanel } from "@/components/trust-safety/trust-safety-panel"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import { createTrustSafetyServerClient } from "@/lib/trust-safety/client"
import { createTrustSafetyDependencies } from "@/lib/trust-safety/repository"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function TrustSafetyPage() {
  const auth = await readPageAuthProfile()
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured")
    redirect("/auth/login?next=/mypage/trust-safety")
  if (auth.kind === "profile_required") redirect("/onboarding/profile")
  const dependencies = createTrustSafetyDependencies(await createTrustSafetyServerClient())
  const [reports, blocks] = await Promise.all([
    dependencies.listReports({ page: 1, pageSize: 50 }, false),
    dependencies.listBlocks({ page: 1, pageSize: 50 }),
  ])
  if (!reports.data || !blocks.data) {
    return (
      <main className="min-h-[100dvh]">
        <PublicHeader auth={auth} />
        <section className="mx-auto grid max-w-[760px] gap-4 px-4 py-12">
          <CircleAlert className="size-6 text-[var(--status-warning)]" />
          <h1 className="m-0 text-3xl font-bold text-primary">
            안전 관리 정보를 불러오지 못했어요
          </h1>
          <p className="m-0 text-secondary">잠시 후 다시 시도해 주세요.</p>
        </section>
      </main>
    )
  }
  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />
      <section className="mx-auto grid w-full max-w-[760px] gap-7 px-4 pb-14 pt-8 md:px-6 md:pt-12">
        <Link
          className="inline-flex min-h-11 w-fit items-center gap-2 text-sm font-bold text-secondary hover:text-primary"
          href="/mypage"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          마이페이지
        </Link>
        <header className="grid gap-3">
          <Shield aria-hidden="true" className="size-8 text-accent" />
          <h1 className="m-0 text-[34px] font-bold leading-tight text-primary">신고와 차단</h1>
          <p className="m-0 text-base leading-7 text-secondary">
            수업과 서비스 이용 중 확인이 필요한 내용을 접수하고 관리해요.
          </p>
        </header>
        <TrustSafetyPanel initialBlocks={blocks.data.items} initialReports={reports.data.items} />
      </section>
    </main>
  )
}
