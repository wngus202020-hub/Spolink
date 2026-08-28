import { redirect } from "next/navigation"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import { readPaymentPageData } from "@/lib/payments/payment-page-data"
import { createReservationPaymentPage } from "./payment-page-runtime"

export const dynamic = "force-dynamic"
export const revalidate = 0

const ReservationPaymentPage = createReservationPaymentPage({
  readAuth: readPageAuthProfile,
  readData: readPaymentPageData,
  redirectTo: redirect,
})

export default ReservationPaymentPage
