import type { NextRequest } from "next/server"
import { createRestrictedHandler, defaultRestrictedDependencies } from "@/lib/auth/restricted-route"

export const GET = (request: NextRequest) =>
  createRestrictedHandler(defaultRestrictedDependencies)(request)
