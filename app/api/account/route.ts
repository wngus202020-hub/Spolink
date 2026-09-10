import type { NextRequest } from "next/server"

import { defaultAccountRouteDependencies } from "@/lib/account/default-dependencies"
import { createAccountWithdrawalRouteHandler } from "@/lib/account/route-handler"

const withdrawAccount = createAccountWithdrawalRouteHandler(defaultAccountRouteDependencies)

export const DELETE = (request: NextRequest) => withdrawAccount(request)
