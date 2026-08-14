import type { NextRequest } from "next/server"
import { createCallbackHandler, defaultCallbackDependencies } from "@/lib/auth/callback-route"

export const GET = (request: NextRequest) =>
  createCallbackHandler(defaultCallbackDependencies)(request)
