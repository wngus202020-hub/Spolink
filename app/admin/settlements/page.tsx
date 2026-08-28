import Link from "next/link"
import { redirect } from "next/navigation"

import { PublicHeader } from "@/components/layout/public-header"
import { SettlementList } from "@/components/money/settlement-list"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import { createSupabaseServerComponentClient } from "@/lib/auth/server-profile"
import { listSettlements, parseSettlementFilterStatus } from "@/lib/money/read-model"

export const dynamic = "force-dynamic"
export const revalidate = 0

type AdminSettlementsPageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>
}>

const settlementFilters = [
  { label: "전체", status: "all" },
  { label: "대기", status: "pending" },
  { label: "보류", status: "hold" },
  { label: "승인", status: "approved" },
] as const

export default async function AdminSettlementsPage({ searchParams }: AdminSettlementsPageProps) {
  const auth = await readPageAuthProfile()
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured")
    redirect("/auth/login?next=/admin/settlements")
  if (auth.kind === "profile_required") redirect("/onboarding/profile")
  if (auth.profile.role !== "admin" || auth.profile.status !== "active") redirect("/mypage")
  const status = parseSettlementFilterStatus((await searchParams)["status"])
  if (!status) redirect("/admin/settlements")
  const { data, error } = await listSettlements(await createSupabaseServerComponentClient(), status)
  if (error) throw new AdminSettlementsReadError()
  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />
      <section className="mx-auto grid w-full max-w-[1120px] gap-7 px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <header className="grid gap-3 border-b border-line pb-6">
          <h1 className="m-0 text-[34px] font-bold leading-tight text-primary">정산 운영</h1>
          <p className="m-0 text-base leading-7 text-secondary">
            내부 정산을 승인하거나 보류해요. 지급 provider 호출이나 지급 완료 상태는 포함되지
            않아요.
          </p>
        </header>
        <nav aria-label="정산 상태 필터" className="flex flex-wrap gap-2">
          {settlementFilters.map((filter) => (
            <Link
              aria-current={status === filter.status ? "page" : undefined}
              className={[
                "inline-flex min-h-11 items-center rounded-[var(--radius-pill)] border px-4 text-sm font-bold",
                status === filter.status
                  ? "border-primary bg-primary text-canvas"
                  : "border-line bg-canvas text-secondary hover:bg-inset",
              ].join(" ")}
              href={`/admin/settlements?status=${filter.status}`}
              key={filter.status}
            >
              {filter.label}
            </Link>
          ))}
        </nav>
        <SettlementList admin settlements={data ?? []} />
      </section>
    </main>
  )
}

class AdminSettlementsReadError extends Error {
  readonly name = "AdminSettlementsReadError"
}
