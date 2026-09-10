import path from "node:path"
import { expect, test } from "@playwright/test"
import postgres from "postgres"

import { testEmail, testPassword } from "./auth-form-helpers"
import { cleanupLiveAuthUser, createLiveAuthSession } from "./auth-recovery-helpers"

test("notification inbox receives realtime rows and registers a private push subscription", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "notification-push")
  const notificationId = crypto.randomUUID()
  const endpoint = `https://push.example.test/subscriptions/${crypto.randomUUID()}`

  try {
    await installPushManagerHarness(page, endpoint)
    const session = await createLiveAuthSession(page, email, testPassword)
    await withDb(async (sql) => {
      await sql`insert into public.profiles (id, display_name, real_name, phone, default_region) values (${session.userId}, '실시간 알림 학습자', '김알림', '010-8555-5555', '서울 성동구')`
    })

    await page.context().grantPermissions(["notifications"], { origin: new URL(page.url()).origin })
    await page.goto("/mypage/notifications")
    await expect(page.getByRole("heading", { level: 1, name: "알림" })).toBeVisible()
    const pushSwitch = page.getByRole("switch", { name: "푸시 알림 켜기" })
    await expect(pushSwitch).toBeVisible()
    await expect(pushSwitch).toHaveAttribute("aria-checked", "false")
    await expect(page.getByText("실시간 알림 연결됨")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("새 알림이 없어요.")).toBeVisible()

    await pushSwitch.click()
    const enabledSwitch = page.getByRole("switch", { name: "푸시 알림 끄기" })
    await expect(enabledSwitch).toHaveAttribute("aria-checked", "true", { timeout: 15_000 })

    const workerScript = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready
      return registration.active?.scriptURL ?? null
    })
    expect(workerScript).toMatch(/\/spolink-sw\.js$/u)

    await withDb(async (sql) => {
      const [subscription] = await sql`
        select user_id::text as user_id, disabled_at
        from public.push_subscriptions
        where user_id = ${session.userId}
      `
      expect(subscription?.["user_id"]).toBe(session.userId)
      expect(subscription?.["disabled_at"]).toBeNull()
      await sql`
        insert into public.notifications (id, user_id, type, title, body, data, event_key)
        values (
          ${notificationId},
          ${session.userId},
          'reservation.completed',
          '수업이 완료되었습니다',
          '이제 후기를 작성할 수 있어요.',
          ${sql.json({ reservationId: notificationId })},
          ${`notification-push:${notificationId}`}
        )
      `
    })

    await expect(page.getByText("수업이 완료되었습니다")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("이제 후기를 작성할 수 있어요.")).toBeVisible()
    await expect(page.getByText("새 알림이 없어요.")).toHaveCount(0)

    await withDb(async (sql) => {
      const [delivery] = await sql`
        select status::text as status
        from public.notification_push_deliveries
        where notification_id = ${notificationId}
      `
      expect(delivery?.["status"]).toBe("pending")
    })
    await captureScreenshot(page, testInfo.project.name, "enabled")

    await enabledSwitch.click()
    await expect(page.getByRole("switch", { name: "푸시 알림 켜기" })).toHaveAttribute(
      "aria-checked",
      "false",
    )
    await withDb(async (sql) => {
      const [subscription] = await sql`
        select disabled_at
        from public.push_subscriptions
        where user_id = ${session.userId}
      `
      expect(subscription?.["disabled_at"]).not.toBeNull()
    })
    await captureScreenshot(page, testInfo.project.name, "disabled")
  } finally {
    await cleanupLiveAuthUser(email)
  }
})

async function installPushManagerHarness(page: import("@playwright/test").Page, endpoint: string) {
  await page.addInitScript((subscriptionEndpoint) => {
    type HarnessSubscription = Readonly<{
      endpoint: string
      expirationTime: null
      toJSON: () => Readonly<{
        endpoint: string
        expirationTime: null
        keys: Readonly<{ auth: string; p256dh: string }>
      }>
      unsubscribe: () => Promise<boolean>
    }>

    let current: HarnessSubscription | null = null
    const createSubscription = (): HarnessSubscription => ({
      endpoint: subscriptionEndpoint,
      expirationTime: null,
      toJSON: () => ({
        endpoint: subscriptionEndpoint,
        expirationTime: null,
        keys: { auth: "A".repeat(24), p256dh: "B".repeat(87) },
      }),
      unsubscribe: async () => {
        current = null
        return true
      },
    })
    const pushManager = {
      getSubscription: async () => current,
      subscribe: async () => {
        current = createSubscription()
        return current
      },
    }

    Object.defineProperty(Notification, "permission", {
      configurable: true,
      get: () => "granted",
    })
    if (!("PushManager" in window)) {
      Object.defineProperty(window, "PushManager", { configurable: true, value: class {} })
    }
    Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", {
      configurable: true,
      get: () => pushManager,
    })
  }, endpoint)
}

async function captureScreenshot(
  page: import("@playwright/test").Page,
  projectName: string,
  state: "disabled" | "enabled",
) {
  const visualQaDir = process.env["SPOLINK_VISUAL_QA_DIR"]
  if (!visualQaDir) return
  await page.addStyleTag({
    content: "nextjs-portal, [data-nextjs-dev-overlay] { display: none !important; }",
  })
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: path.join(visualQaDir, `notification-push-${state}-${projectName}.png`),
  })
}

async function withDb<T>(run: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const dbUrl = process.env["SPOLINK_AUTH_E2E_DB_URL"]
  if (!dbUrl) throw new Error("SPOLINK_AUTH_E2E_DB_URL is required.")
  const sql = postgres(dbUrl, { idle_timeout: 1, max: 1 })
  try {
    return await run(sql)
  } finally {
    await sql.end({ timeout: 1 })
  }
}
