import type { NextRequest } from "next/server"
import { createLogoutHandler, defaultLogoutDependencies } from "@/lib/auth/logout-route"

export const POST = (request: NextRequest) =>
  createLogoutHandler(defaultLogoutDependencies)(request)
