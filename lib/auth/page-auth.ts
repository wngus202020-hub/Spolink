import "server-only"

import { redirect } from "next/navigation"
import { readServerAuthProfile, type ServerAuthProfile } from "@/lib/auth/server-profile"

export type PageAuthProfile = Exclude<
  ServerAuthProfile,
  { kind: "account_deleted" | "account_suspended" }
>

export async function readPageAuthProfile(): Promise<PageAuthProfile> {
  const state = await readServerAuthProfile()
  if (state.kind === "account_suspended") {
    redirect("/auth/restricted?reason=account-suspended")
  }
  if (state.kind === "account_deleted") {
    redirect("/auth/restricted?reason=account-deleted")
  }
  return state
}
