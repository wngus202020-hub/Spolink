import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { PublicHeader } from "@/components/layout/public-header"
import type { PageAuthProfile } from "@/lib/auth/page-auth"
import type { PaymentPageData } from "@/lib/payments/payment-page-data"
import { PaymentDetails } from "./payment-details"
import { getPaymentStatePresentation } from "./payment-page-presentation"
import { getPaymentPageRedirectPath } from "./payment-page-route"
import { PaymentStatePanel } from "./payment-state-panel"

type ReservationPaymentPageProps = Readonly<{
  params: Promise<{ reservationId: string }>
}>

type PaymentPageDependencies = Readonly<{
  readAuth: () => Promise<PageAuthProfile>
  readData: (reservationId: string, learnerId: string) => Promise<PaymentPageData>
  redirectTo: (path: string) => never
}>

export function createReservationPaymentPage(dependencies: PaymentPageDependencies) {
  return async function ReservationPaymentPage({ params }: ReservationPaymentPageProps) {
    const [{ reservationId }, auth] = await Promise.all([params, dependencies.readAuth()])
    const nextPath = `/reservations/${reservationId}/payment`
    if (auth.kind === "unauthenticated" || auth.kind === "unconfigured") {
      dependencies.redirectTo(`/auth/login?next=${nextPath}`)
    }
    if (auth.kind === "profile_required") {
      dependencies.redirectTo("/onboarding/profile")
    }

    const paymentPageData = await dependencies.readData(reservationId, auth.profile.id)
    const redirectPath = getPaymentPageRedirectPath(paymentPageData.state, reservationId)
    if (redirectPath) {
      dependencies.redirectTo(redirectPath)
    }

    return (
      <main className="min-h-[100dvh]">
        <PublicHeader auth={auth} />

        <section className="mx-auto grid w-full max-w-[1180px] gap-6 px-4 pb-14 pt-6 md:px-6">
          <Link
            className="inline-flex min-h-10 w-fit items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-canvas px-4 text-sm font-bold text-secondary hover:bg-inset"
            href="/lessons"
          >
            <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.8} />
            레슨 목록
          </Link>

          <PaymentStatePanel
            presentation={getPaymentStatePresentation(paymentPageData.state)}
            role={paymentPageData.state === "read_failure" ? "alert" : undefined}
          />

          {paymentPageData.viewModel ? (
            <PaymentDetails
              returnPath={nextPath}
              showPreparation={
                paymentPageData.state === "pending_valid" || paymentPageData.state === "ready"
              }
              viewModel={paymentPageData.viewModel}
            />
          ) : null}
        </section>
      </main>
    )
  }
}
