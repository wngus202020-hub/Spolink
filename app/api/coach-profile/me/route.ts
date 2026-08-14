import { applicantRouteDependencies } from "@/lib/coach-certification/applicant-default-dependencies"
import {
  createGetCoachApplicationRouteHandler,
  createPutCoachApplicationRouteHandler,
} from "@/lib/coach-certification/applicant-route-handlers"

export const GET = createGetCoachApplicationRouteHandler(applicantRouteDependencies)
export const PUT = createPutCoachApplicationRouteHandler(applicantRouteDependencies)
