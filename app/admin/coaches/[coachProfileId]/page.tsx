import { ArrowLeft, Award, BriefcaseBusiness, Building2, MapPin, UserRound } from "lucide-react"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import type { ReactNode } from "react"

import { AdminCoachStatusBadge } from "@/components/admin/admin-coach-status-badge"
import { CertificateReadButton } from "@/components/admin/certificate-read-button"
import { CoachReviewActions } from "@/components/admin/coach-review-actions"
import { PublicHeader } from "@/components/layout/public-header"
import {
  createSupabaseServerComponentClient,
  readServerAuthProfile,
} from "@/lib/auth/server-profile"
import { createAdminReviewDependencies } from "@/lib/coach-certification/admin-repository"

export const dynamic = "force-dynamic"
export const fetchCache = "force-no-store"
export const revalidate = 0

type AdminCoachDetailPageProps = Readonly<{
  params: Promise<Readonly<{ coachProfileId: string }>>
}>

export default async function AdminCoachDetailPage({ params }: AdminCoachDetailPageProps) {
  const { coachProfileId } = await params
  const auth = await readServerAuthProfile()
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured") {
    redirect(`/auth/login?next=/admin/coaches/${coachProfileId}`)
  }
  if (auth.kind === "profile_required") redirect("/onboarding/profile")
  if (auth.kind === "account_deleted") redirect("/auth/restricted?reason=account-deleted")
  if (auth.kind === "account_suspended") redirect("/auth/restricted?reason=account-suspended")
  if (auth.profile.role !== "admin" || auth.profile.status !== "active") redirect("/mypage")

  const supabase = await createSupabaseServerComponentClient()
  const result = await createAdminReviewDependencies(supabase).readApplication(coachProfileId)
  if (result.errorCode === "COACH_APPLICATION_NOT_FOUND") notFound()
  if (result.errorCode || !result.data) throw new AdminCoachDetailReadError()
  const application = result.data

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />
      <section className="mx-auto grid w-full max-w-[1080px] gap-6 px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <Link
          className="inline-flex min-h-11 w-fit items-center gap-2 text-sm font-bold text-secondary hover:text-primary"
          href="/admin/coaches"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          심사 목록
        </Link>

        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-3">
            <AdminCoachStatusBadge status={application.status} />
            <h1 className="m-0 break-keep text-[34px] font-bold leading-[1.18] text-primary md:text-5xl">
              {application.displayName}님의 지도자 신청
            </h1>
            <p className="m-0 break-keep text-base leading-[1.7] text-secondary">
              {application.headline ?? "지도자 소개가 등록되지 않았습니다."}
            </p>
          </div>
          <dl className="m-0 grid gap-1 text-right text-sm">
            <dt className="text-secondary">제출일</dt>
            <dd className="m-0 font-bold text-primary">{formatDate(application.submittedAt)}</dd>
            <dt className="mt-2 text-secondary">검토일</dt>
            <dd className="m-0 font-bold text-primary">{formatDate(application.reviewedAt)}</dd>
          </dl>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-6">
            <section
              aria-labelledby="profile-heading"
              className="grid gap-5 rounded-[var(--radius-xl)] border border-line bg-canvas p-5 [box-shadow:var(--shadow-panel)] md:p-6"
            >
              <h2 className="m-0 text-2xl font-bold text-primary" id="profile-heading">
                신청 프로필
              </h2>
              <dl className="m-0 grid gap-4 sm:grid-cols-2">
                <Info label="신청자" value={application.displayName}>
                  <UserRound aria-hidden="true" className="size-4" />
                </Info>
                <Info label="전문 종목" value={application.sportName ?? "미등록"}>
                  <Award aria-hidden="true" className="size-4" />
                </Info>
                <Info label="활동 지역" value={application.serviceRegion}>
                  <MapPin aria-hidden="true" className="size-4" />
                </Info>
                <Info label="지도 경력" value={`${application.careerYears}년`}>
                  <BriefcaseBusiness aria-hidden="true" className="size-4" />
                </Info>
              </dl>
              <div className="grid gap-2 border-t border-line pt-5">
                <h3 className="m-0 text-sm font-bold text-primary">소개</h3>
                <p className="m-0 whitespace-pre-wrap break-keep text-sm leading-[1.7] text-secondary">
                  {application.bio ?? "소개가 등록되지 않았습니다."}
                </p>
              </div>
            </section>

            <section
              aria-labelledby="certificates-heading"
              className="grid gap-4 rounded-[var(--radius-xl)] border border-line bg-canvas p-5 md:p-6"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="m-0 text-2xl font-bold text-primary" id="certificates-heading">
                  자격증
                </h2>
                <span className="text-sm font-bold text-secondary">
                  {application.certificates.length}개
                </span>
              </div>
              <ul className="m-0 grid list-none divide-y divide-line p-0">
                {application.certificates.map((certificate) => (
                  <li
                    className="flex min-h-20 flex-wrap items-center justify-between gap-4 py-4"
                    key={certificate.id}
                  >
                    <div className="grid gap-1">
                      <strong className="text-sm text-primary">
                        {certificate.certificateName}
                      </strong>
                      <span className="text-xs text-secondary">
                        {certificate.issuer ?? "발급 기관 미등록"} ·{" "}
                        {certificate.certificateNumber ?? "번호 미등록"}
                      </span>
                    </div>
                    <CertificateReadButton
                      certificateId={certificate.id}
                      coachProfileId={application.id}
                    />
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <aside className="h-fit rounded-[var(--radius-xl)] border border-line bg-subtle p-5 lg:sticky lg:top-6">
            <div className="grid gap-4">
              <div className="grid gap-1">
                <h2 className="m-0 inline-flex items-center gap-2 text-lg font-bold text-primary">
                  <Building2 aria-hidden="true" className="size-5 text-accent" />
                  정산 정보 요약
                </h2>
                <p className="m-0 text-xs leading-[1.6] text-secondary">
                  전체 계좌번호는 저장하거나 표시하지 않습니다.
                </p>
              </div>
              <dl className="m-0 grid gap-3 text-sm">
                <Summary label="은행" value={application.bankName ?? "미등록"} />
                <Summary label="예금주" value={application.payoutHolderName ?? "미등록"} />
                <Summary
                  label="계좌 끝 4자리"
                  value={
                    application.bankAccountLast4 ? `•••• ${application.bankAccountLast4}` : "미등록"
                  }
                />
              </dl>
              {application.status === "rejected" && application.rejectionReason ? (
                <div className="grid gap-1 border-t border-line pt-4">
                  <strong className="text-sm text-primary">반려 사유</strong>
                  <p className="m-0 whitespace-pre-wrap text-sm leading-[1.6] text-secondary">
                    {application.rejectionReason}
                  </p>
                </div>
              ) : null}
            </div>
          </aside>
        </div>

        {application.status === "submitted" ? (
          <CoachReviewActions coachProfileId={application.id} />
        ) : null}
      </section>
    </main>
  )
}

function Info({
  children,
  label,
  value,
}: Readonly<{ children: ReactNode; label: string; value: string }>) {
  return (
    <div className="grid gap-1">
      <dt className="inline-flex items-center gap-2 text-xs font-bold text-secondary">
        {children}
        {label}
      </dt>
      <dd className="m-0 text-sm font-bold text-primary">{value}</dd>
    </div>
  )
}

function Summary({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-secondary">{label}</dt>
      <dd className="m-0 font-bold text-primary">{value}</dd>
    </div>
  )
}

function formatDate(value: string | null) {
  if (!value) return "기록 없음"
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value))
}

class AdminCoachDetailReadError extends Error {
  readonly name = "AdminCoachDetailReadError"
}
