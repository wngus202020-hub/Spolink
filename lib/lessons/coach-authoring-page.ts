import "server-only"

import { redirect } from "next/navigation"

import { readPageAuthProfile } from "../auth/page-auth"
import { createSupabaseServerComponentClient } from "../auth/server-profile"

export async function readApprovedCoachPage(nextPath: string) {
  const auth = await readPageAuthProfile()
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured") {
    redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`)
  }
  if (auth.kind === "profile_required") redirect("/onboarding/profile")
  const coachProfile = auth.coachProfile
  if (coachProfile?.status !== "approved" || auth.profile.status !== "coach_approved") {
    redirect("/coach/apply/status")
  }
  return {
    auth: { ...auth, coachProfile },
    supabase: await createSupabaseServerComponentClient(),
  }
}
