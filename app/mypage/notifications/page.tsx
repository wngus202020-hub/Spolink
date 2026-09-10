import { Bell } from "lucide-react"
import { redirect } from "next/navigation"
import { PublicHeader } from "@/components/layout/public-header"
import { NotificationList } from "@/components/notifications/notification-list"
import { PushNotificationToggle } from "@/components/notifications/push-notification-toggle"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import { createSupabaseServerComponentClient } from "@/lib/auth/server-profile"
import { createNotificationRepository } from "@/lib/notifications/repository"
import { getWebPushConfigStatus, readWebPushEnv } from "@/lib/supabase/env"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function NotificationsPage() {
  const auth = await readPageAuthProfile()
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured")
    redirect("/auth/login?next=/mypage/notifications")
  if (auth.kind === "profile_required") redirect("/onboarding/profile")
  const client = await createSupabaseServerComponentClient()
  const page = await createNotificationRepository(client).list(auth.profile.id, {
    cursor: null,
    page: 1,
    pageSize: 50,
    unreadOnly: false,
  })
  const pushConfig = getWebPushConfigStatus()

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />
      <section className="mx-auto grid w-full max-w-[760px] gap-7 px-4 pb-14 pt-8 md:px-6 md:pt-12">
        <div className="grid gap-2">
          <span className="inline-flex size-12 items-center justify-center rounded-[var(--radius-lg)] bg-accent-soft text-primary">
            <Bell aria-hidden="true" className="size-6" />
          </span>
          <h1 className="m-0 text-[34px] font-bold leading-[1.18] text-primary">알림</h1>
          <p className="m-0 text-sm leading-[1.6] text-secondary">
            예약과 활동의 중요한 변화를 확인해요.
          </p>
        </div>
        {pushConfig.configured ? (
          <PushNotificationToggle publicKey={readWebPushEnv().publicKey} />
        ) : null}
        <NotificationList initialItems={page?.items ?? []} profileId={auth.profile.id} />
      </section>
    </main>
  )
}
