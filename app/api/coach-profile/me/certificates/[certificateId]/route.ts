import { applicantRouteDependencies } from "@/lib/coach-certification/applicant-default-dependencies"
import { createDeleteCertificateRouteHandler } from "@/lib/coach-certification/applicant-route-handlers"

export const DELETE = createDeleteCertificateRouteHandler(applicantRouteDependencies)
