import type { NextRequest } from "next/server"
import {
  createUpdatePasswordHandler,
  defaultUpdatePasswordDependencies,
} from "@/lib/auth/update-password-route"

export const POST = (request: NextRequest) =>
  createUpdatePasswordHandler(defaultUpdatePasswordDependencies)(request)
