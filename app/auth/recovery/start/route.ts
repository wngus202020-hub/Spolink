import type { NextRequest } from "next/server"
import {
  createRecoveryStartHandler,
  defaultRecoveryStartDependencies,
} from "@/lib/auth/recovery-start-route"

export const POST = (request: NextRequest) =>
  createRecoveryStartHandler(defaultRecoveryStartDependencies)(request)
