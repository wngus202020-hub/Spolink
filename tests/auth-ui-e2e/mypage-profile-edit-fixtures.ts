import { createHash } from "node:crypto"
import type { Page, TestInfo } from "@playwright/test"
import postgres from "postgres"
import { testEmail, testPassword } from "./auth-form-helpers"
import { cleanupLiveAuthUser, createLiveAuthSession } from "./auth-recovery-helpers"

export type ProfileEditSession = Readonly<{
  email: string
  userId: string
}>

export type ProfileSeed = Readonly<{
  defaultRegion: string | null
  displayName: string
  locationAgreed: boolean
  marketingAgreed: boolean
  phone: string
  realName: string
  status?: "active" | "deleted" | "suspended"
}>

export type ProfileSnapshot = Readonly<{
  defaultRegion: string | null
  displayNameHash: string
  locationAgreed: boolean
  marketingAgreed: boolean
  phoneHash: string | null
  realNameHash: string | null
  status: string
}>

export function profileEditValues(testInfo: TestInfo, label: string): ProfileSeed {
  const digest = createHash("sha256")
    .update(`${testInfo.project.name}:${testInfo.title}:${label}`)
    .digest("hex")
  const short = Number.parseInt(digest.slice(0, 4), 16).toString(36).slice(0, 2).padEnd(2, "가")
  const phoneTail = digest
    .slice(0, 8)
    .replaceAll(/[a-f]/gu, (value) => String(value.charCodeAt(0) - 87))
    .slice(0, 8)

  return {
    defaultRegion: "서울특별시 강남구",
    displayName: `활동${short}`,
    locationAgreed: label.length % 2 === 0,
    marketingAgreed: label.length % 2 === 1,
    phone: `010-${phoneTail.slice(0, 4)}-${phoneTail.slice(4, 8)}`,
    realName: `실명${short}`,
  }
}

export async function createProfileEditSession(
  page: Page,
  testInfo: TestInfo,
  label: string,
): Promise<ProfileEditSession> {
  const email = testEmail(testInfo, `profile-edit-${label}`)
  const session = await createLiveAuthSession(page, email, testPassword)
  return { email, userId: session.userId }
}

export async function cleanupProfileEditSession(session: ProfileEditSession): Promise<void> {
  await withProfileEditDb(async (sql) => {
    await sql`delete from public.profiles where id = ${session.userId}`
  })
  await cleanupLiveAuthUser(session.email)
}

export async function insertProfileEditProfile(userId: string, seed: ProfileSeed): Promise<void> {
  const status = seed.status ?? "active"
  await withProfileEditDb(async (sql) => {
    await sql`
      insert into public.profiles (
        id,
        display_name,
        real_name,
        phone,
        default_region,
        status,
        location_agreed_at,
        marketing_agreed_at,
        deleted_at
      )
      values (
        ${userId},
        ${seed.displayName},
        ${seed.realName},
        ${seed.phone},
        ${seed.defaultRegion},
        ${status},
        ${seed.locationAgreed ? new Date("2026-08-20T00:00:00.000Z").toISOString() : null},
        ${seed.marketingAgreed ? new Date("2026-08-21T00:00:00.000Z").toISOString() : null},
        ${status === "deleted" ? new Date("2026-08-21T00:00:00.000Z").toISOString() : null}
      )
    `
  })
}

export async function readProfileEditSnapshot(userId: string): Promise<ProfileSnapshot> {
  return withProfileEditDb(async (sql) => {
    const [row] = await sql`
      select
        default_region,
        display_name,
        location_agreed_at,
        marketing_agreed_at,
        phone,
        real_name,
        status
      from public.profiles
      where id = ${userId}
    `
    if (!row) throw new Error("Profile edit snapshot row is missing.")

    return {
      defaultRegion: typeof row["default_region"] === "string" ? row["default_region"] : null,
      displayNameHash: hashRequired(row["display_name"]),
      locationAgreed: row["location_agreed_at"] !== null,
      marketingAgreed: row["marketing_agreed_at"] !== null,
      phoneHash: hashNullable(row["phone"]),
      realNameHash: hashNullable(row["real_name"]),
      status: String(row["status"]),
    }
  })
}

async function withProfileEditDb<T>(run: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const dbUrl = process.env["SPOLINK_AUTH_E2E_DB_URL"]
  if (!dbUrl) throw new Error("SPOLINK_AUTH_E2E_DB_URL is required.")
  const sql = postgres(dbUrl, { idle_timeout: 1, max: 1 })
  try {
    return await run(sql)
  } finally {
    await sql.end({ timeout: 1 })
  }
}

function hashNullable(value: unknown): string | null {
  if (typeof value !== "string") return null
  return createHash("sha256").update(value).digest("hex")
}

function hashRequired(value: unknown): string {
  if (typeof value !== "string") throw new Error("Profile edit required value is missing.")
  return createHash("sha256").update(value).digest("hex")
}
