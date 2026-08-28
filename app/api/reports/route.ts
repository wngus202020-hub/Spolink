import { trustSafetyRouteDependencies } from "@/lib/trust-safety/default-dependencies"
import {
  createCreateReportRouteHandler,
  createListReportsRouteHandler,
} from "@/lib/trust-safety/route-handlers"

export const dynamic = "force-dynamic"

export const GET = createListReportsRouteHandler(trustSafetyRouteDependencies)
export const POST = createCreateReportRouteHandler(trustSafetyRouteDependencies)
