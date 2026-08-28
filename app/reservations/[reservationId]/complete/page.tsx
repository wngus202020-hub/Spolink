import { notFound, redirect } from "next/navigation"
import { PublicHeader } from "@/components/layout/public-header"
import {
  ReservationCompletionRecovery,
  ReservationCompletionView,
} from "@/components/reservations/reservation-completion-view"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import { readReservationCompletionPageData } from "@/lib/reservations/completion-page-data"
import { readReservationDetailSnapshot } from "@/lib/reservations/read-model"

type ReservationCompletionPageProps = Readonly<{
  params: Promise<{ reservationId: string }>
}>

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function ReservationCompletionPage({
  params,
}: ReservationCompletionPageProps) {
  const [{ reservationId }, auth] = await Promise.all([params, readPageAuthProfile()])
  const nextPath = `/reservations/${reservationId}/complete`

  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured") {
    const encodedNext = encodeURIComponent(nextPath)
    redirect(`/auth/login?next=${encodedNext}`)
  }
  if (auth.kind === "profile_required") {
    redirect("/onboarding/profile")
  }

  const completion = await readReservationCompletionPageData(
    reservationId,
    auth.profile.id,
    readReservationDetailSnapshot,
  )

  switch (completion.state) {
    case "not_found":
      return notFound()
    case "pending":
      return redirect(`/reservations/${reservationId}/payment`)
    case "terminal":
      return redirect(`/mypage/reservations/${reservationId}`)
    case "complete":
      return (
        <main className="min-h-[100dvh]">
          <PublicHeader auth={auth} />
          {completion.viewModel ? (
            <ReservationCompletionView reservation={completion.viewModel} />
          ) : (
            <ReservationCompletionRecovery retryHref={nextPath} />
          )}
        </main>
      )
    case "mismatch":
    case "read_failure":
      return (
        <main className="min-h-[100dvh]">
          <PublicHeader auth={auth} />
          <ReservationCompletionRecovery retryHref={nextPath} />
        </main>
      )
  }
}
