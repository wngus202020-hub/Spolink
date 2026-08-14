import { applicantRouteDependencies } from "@/lib/coach-certification/applicant-default-dependencies"
import { createCertificateUploadRouteHandler } from "@/lib/coach-certification/applicant-route-handlers"

export const POST = createCertificateUploadRouteHandler(applicantRouteDependencies)
