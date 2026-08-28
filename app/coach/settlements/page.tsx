import { PublicHeader } from "@/components/layout/public-header"
import { SettlementList } from "@/components/money/settlement-list"
import { readApprovedCoachPage } from "@/lib/lessons/coach-authoring-page"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function CoachSettlementsPage() {
  const { auth, supabase } = await readApprovedCoachPage("/coach/settlements")
  const { data, error } = await supabase
    .from("settlements")
    .select("id,status,gross_amount,refund_amount,net_amount,hold_reason,reservation_id,created_at")
    .eq("coach_profile_id", auth.coachProfile.id)
    .order("created_at", { ascending: false })
  if (error) throw new Error("Coach settlements could not be read")
  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />
      <section className="mx-auto grid w-full max-w-[1120px] gap-7 px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <header className="grid gap-3 border-b border-line pb-6">
          <h1 className="m-0 text-[34px] font-bold leading-tight text-primary">내부 정산 상태</h1>
          <p className="m-0 text-base leading-7 text-secondary">
            완료 수업에 연결된 정산 상태와 금액을 확인해요. 이 화면은 지급 실행을 제공하지 않아요.
          </p>
        </header>
        <SettlementList admin={false} settlements={data ?? []} />
      </section>
    </main>
  )
}
