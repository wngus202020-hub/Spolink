import { ArrowLeft, CircleAlert } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PublicHeader } from "@/components/layout/public-header"
import { ReviewForm } from "@/components/reviews/review-form"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import { readReservationDetailData } from "@/lib/reservations/read-model"

export const dynamic = "force-dynamic"
export const revalidate = 0
type Props = Readonly<{ searchParams: Promise<{ reservationId?: string | string[] }> }>

export default async function NewReviewPage({ searchParams }: Props) {
  const [auth, query] = await Promise.all([readPageAuthProfile(), searchParams])
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured")
    redirect("/auth/login?next=/mypage/reviews/new")
  if (auth.kind === "profile_required") redirect("/onboarding/profile")
  const reservationId = typeof query.reservationId === "string" ? query.reservationId : ""
  const reservation = reservationId
    ? await readReservationDetailData(reservationId, auth.profile.id)
    : null
  const eligible =
    reservation?.state === "ready" && reservation.viewModel?.status.label === "수업 완료"
  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />
      <section className="mx-auto grid w-full max-w-[1120px] gap-6 px-4 pb-14 pt-6 md:px-6 md:pt-10">
        <Link
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-canvas px-4 text-sm font-bold text-secondary"
          href="/mypage/reservations"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />내 예약
        </Link>
        <div className="grid gap-2">
          <h1 className="m-0 text-[34px] font-bold leading-tight text-primary">수업 후기 남기기</h1>
          <p className="m-0 text-base leading-relaxed text-secondary">
            완료한 수업의 경험을 다음 학습자와 나눠 주세요.
          </p>
        </div>
        {eligible ? (
          <ReviewForm reservationId={reservationId} />
        ) : (
          <section
            className="grid max-w-2xl gap-3 rounded-[var(--radius-xl)] border border-line bg-subtle p-6"
            role="alert"
          >
            <CircleAlert aria-hidden="true" className="size-6 text-[var(--status-warning)]" />
            <h2 className="m-0 text-xl font-bold text-primary">후기를 남길 수 없는 예약이에요</h2>
            <p className="m-0 text-sm leading-relaxed text-secondary">
              완료된 본인 예약만 후기를 작성할 수 있어요.
            </p>
          </section>
        )}
      </section>
    </main>
  )
}
