import { applicantRouteDependencies } from "@/lib/coach-certification/applicant-default-dependencies"
import { createRegisterCertificateRouteHandler } from "@/lib/coach-certification/applicant-route-handlers"

export const POST = createRegisterCertificateRouteHandler(applicantRouteDependencies)
