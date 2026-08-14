import { AlertCircle, CalendarDays, CheckCircle2, Clock3, FilePenLine } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { PublicHeader } from "@/components/layout/public-header"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  createSupabaseServerComponentClient,
  readServerAuthProfile,
} from "@/lib/auth/server-profile"
import { readCoachStatusView } from "@/lib/coach-certification/status-view"
import CoachApplicationStatusLoading from "./loading"

export const dynamic = "force-dynamic"
export const fetchCache = "force-no-store"
export const revalidate = 0

type CoachApplicationStatusPageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>
}>

export default async function CoachApplicationStatusPage({
  searchParams,
}: CoachApplicationStatusPageProps) {
  const auth = await readServerAuthProfile()
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured") {
    redirect("/auth/login?next=/coach/apply/status")
  }
  if (auth.kind === "profile_required") redirect("/onboarding/profile")
  if (auth.kind === "account_deleted") redirect("/auth/restricted?reason=account-deleted")

  const fixture =
    process.env["SPOLINK_COACH_UI_FIXTURES"] === "enabled"
      ? (await searchParams)["uiFixture"]
      : undefined
  if (fixture === "loading") return <CoachApplicationStatusLoading />
  if (fixture === "error") throw new CoachStatusFixtureError()

  const supabase = await createSupabaseServerComponentClient()
  const { data: coachProfile, error } = await supabase
    .from("coach_profiles")
    .select("status,submitted_at,reviewed_at,rejection_reason")
    .eq("user_id", auth.profile.id)
    .maybeSingle()

  if (error)
    throw new CoachStatusReadError("Unable to read coach application status", { cause: error })
  if (!coachProfile) redirect("/coach/apply")

  const displayedStatus = auth.kind === "account_suspended" ? "suspended" : coachProfile.status
  const view = readCoachStatusView(displayedStatus)

  return (
    <main className="min-h-[100dvh]">
      {process.env["SPOLINK_COACH_UI_FIXTURES"] === "enabled" && !fixture ? (
        <Link
          className="sr-only"
          data-testid="coach-status-error-fixture"
          href="/coach/apply/status?uiFixture=error"
          tabIndex={-1}
        >
          오류 상태 열기
        </Link>
      ) : null}
      {auth.kind === "ready" ? <PublicHeader auth={auth} /> : <RestrictedHeader />}
      <section className="mx-auto grid w-full max-w-[880px] gap-6 px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <div className="grid gap-3">
          <StatusBadge tone={view.tone}>{view.label}</StatusBadge>
          <h1 className="m-0 text-pretty text-[34px] font-bold leading-[1.18] text-primary md:text-5xl">
            지도자 인증 신청 상태
          </h1>
          <p className="m-0 max-w-[64ch] break-keep text-base leading-[1.7] text-secondary md:text-lg">
            {view.description}
          </p>
        </div>

        <section
          aria-labelledby="application-status-heading"
          className="grid gap-6 rounded-[var(--radius-xl)] border border-line bg-canvas p-5 [box-shadow:var(--shadow-panel)] md:p-7"
        >
          <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-5">
            <StatusIcon status={displayedStatus} />
            <div className="min-w-0 grid gap-1">
              <h2 className="m-0 text-2xl font-bold text-primary" id="application-status-heading">
                {view.label}
              </h2>
              <p className="m-0 break-keep text-sm leading-[1.6] text-secondary">
                신청 정보는 본인 계정에서만 확인할&nbsp;수&nbsp;있어요.
              </p>
            </div>
          </div>

          <dl className="m-0 grid gap-4 border-y border-line py-5 sm:grid-cols-2">
            <StatusDate label="제출일" value={coachProfile.submitted_at} />
            <StatusDate label="검토일" value={coachProfile.reviewed_at} />
          </dl>

          {displayedStatus === "rejected" ? (
            <div className="grid gap-2 rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--status-error)_24%,transparent)] bg-[color-mix(in_srgb,var(--status-error)_8%,transparent)] p-4">
              <strong className="text-sm text-primary">반려 사유</strong>
              <p className="m-0 whitespace-pre-wrap text-sm leading-[1.7] text-secondary">
                {coachProfile.rejection_reason ?? "반려 사유를 확인할 수 없습니다."}
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-3">
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] bg-accent px-5 py-3 text-sm font-bold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]"
              href={view.actionHref}
            >
              {view.actionLabel}
            </Link>
          </div>
        </section>
      </section>
    </main>
  )
}

function RestrictedHeader() {
  return (
    <header className="mx-auto flex min-h-18 w-full max-w-[1280px] items-center px-4 py-4 md:px-6">
      <Link className="text-xl font-bold text-primary" href="/">
        SPOLINK
      </Link>
    </header>
  )
}

function StatusIcon({
  status,
}: Readonly<{ status: "approved" | "draft" | "rejected" | "submitted" | "suspended" }>) {
  const className = "size-7"
  const wrapper =
    "inline-flex size-14 shrink-0 items-center justify-center rounded-full bg-inset text-accent"
  switch (status) {
    case "approved":
      return (
        <span className={wrapper}>
          <CheckCircle2 aria-hidden="true" className={className} />
        </span>
      )
    case "draft":
      return (
        <span className={wrapper}>
          <FilePenLine aria-hidden="true" className={className} />
        </span>
      )
    case "submitted":
      return (
        <span className={wrapper}>
          <Clock3 aria-hidden="true" className={className} />
        </span>
      )
    case "rejected":
    case "suspended":
      return (
        <span className={wrapper}>
          <AlertCircle aria-hidden="true" className={className} />
        </span>
      )
    default:
      return assertNever(status)
  }
}

function StatusDate({ label, value }: Readonly<{ label: string; value: string | null }>) {
  return (
    <div className="grid gap-1">
      <dt className="flex items-center gap-2 text-xs font-bold text-secondary">
        <CalendarDays aria-hidden="true" className="size-4" />
        {label}
      </dt>
      <dd className="m-0 text-sm font-bold text-primary">{formatDate(value)}</dd>
    </div>
  )
}

function formatDate(value: string | null) {
  if (!value) return "아직 기록되지 않음"
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value))
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected coach certification status: ${value}`)
}

class CoachStatusReadError extends Error {
  readonly name = "CoachStatusReadError"
}

class CoachStatusFixtureError extends Error {
  readonly name = "CoachStatusFixtureError"

  constructor() {
    super("Deterministic coach status error fixture")
  }
}
