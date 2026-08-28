import { trustSafetyRouteDependencies } from "@/lib/trust-safety/default-dependencies"
import {
  createCreateBlockRouteHandler,
  createListBlocksRouteHandler,
} from "@/lib/trust-safety/route-handlers"

export const dynamic = "force-dynamic"

export const GET = createListBlocksRouteHandler(trustSafetyRouteDependencies)
export const POST = createCreateBlockRouteHandler(trustSafetyRouteDependencies)
