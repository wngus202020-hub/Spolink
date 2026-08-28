import { CoachDashboardActivity } from "@/components/coach/coach-dashboard-activity"
import { CoachDashboardOverview } from "@/components/coach/coach-dashboard-overview"
import { CoachDashboardSchedule } from "@/components/coach/coach-dashboard-schedule"
import { PublicHeader } from "@/components/layout/public-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { readCoachDashboard } from "@/lib/coach/dashboard-read-model"
import { readApprovedCoachPage } from "@/lib/lessons/coach-authoring-page"

export const dynamic = "force-dynamic"
export const fetchCache = "force-no-store"
export const revalidate = 0

type Props = Readonly<{
  searchParams?: Promise<{ uiState?: string | readonly string[] }>
}>

export default async function CoachDashboardPage({ searchParams }: Props) {
  const { auth, supabase } = await readApprovedCoachPage("/coach/dashboard")
  const resolvedSearchParams: { readonly uiState?: string | readonly string[] } = searchParams
    ? await searchParams
    : {}
  const fixturesEnabled = process.env["SPOLINK_COACH_DASHBOARD_UI_FIXTURES"] === "enabled"
  const fixtureState =
    fixturesEnabled && typeof resolvedSearchParams.uiState === "string"
      ? resolvedSearchParams.uiState
      : null

  if (fixtureState === "loading") {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  if (fixtureState === "error") {
    throw new CoachDashboardFixtureError()
  }

  const dashboard = await readCoachDashboard({
    client: supabase,
    coachProfileId: auth.coachProfile.id,
    now: new Date(),
    profileId: auth.profile.id,
  })

  return (
    <main className="min-h-dvh bg-canvas">
      <PublicHeader auth={auth} />
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-16 pt-8 md:px-6 md:pt-10">
        <header className="grid gap-3 border-b border-line pb-6">
          <StatusBadge tone="success">승인 완료</StatusBadge>
          <h1 className="m-0 text-4xl font-bold leading-tight text-primary md:text-5xl">
            지도자 운영 센터
          </h1>
          <p className="m-0 max-w-2xl break-keep text-base leading-relaxed text-secondary">
            오늘의 레슨과 처리할 예약, 정산 현황을 한곳에서 확인하세요.
          </p>
        </header>

        <CoachDashboardOverview dashboard={dashboard} />

        <div className="grid min-w-0 gap-8 lg:grid-cols-3">
          <CoachDashboardSchedule schedules={dashboard.todaySchedules} />
          <CoachDashboardActivity dashboard={dashboard} />
        </div>
      </div>
    </main>
  )
}

class CoachDashboardFixtureError extends Error {
  constructor() {
    super("Deterministic coach dashboard error fixture")
    this.name = "CoachDashboardFixtureError"
  }
}
