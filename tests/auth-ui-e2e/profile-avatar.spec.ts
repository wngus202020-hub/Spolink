import { readFile } from "node:fs/promises"
import path from "node:path"
import { expect, test } from "@playwright/test"
import postgres from "postgres"

import {
  cleanupProfileEditSession,
  createProfileEditSession,
  insertProfileEditProfile,
  type ProfileEditSession,
  profileEditValues,
} from "./mypage-profile-edit-fixtures"

const avatarObjectPathSuffix = "/storage/v1/object/public/profile-avatars/profiles/"

test("profile owner uploads, sees, and removes one persistent avatar", async ({
  page,
}, testInfo) => {
  // Given: an authenticated profile owner without a profile image.
  let session: ProfileEditSession | null = null
  try {
    session = await createProfileEditSession(page, testInfo, "avatar")
    const profile = profileEditValues(testInfo, "avatar")
    await insertProfileEditProfile(session.userId, profile)
    await page.goto("/mypage/profile")
    await expect(page.getByRole("heading", { level: 2, name: "프로필 사진" })).toBeVisible()
    await expect(
      page.getByRole("img", { name: `${profile.displayName} 프로필 사진 없음` }),
    ).toBeVisible()

    // When: the owner selects a supported image through the real file input.
    const avatarFile = await readFile(path.resolve("public/images/lesson-tennis.webp"))
    await page.locator('input[type="file"]').setInputFiles({
      buffer: avatarFile,
      mimeType: "image/webp",
      name: "profile-avatar.webp",
    })

    // Then: the image persists in Storage, the profile row, and both member screens.
    await expect(page.getByText("프로필 사진을 저장했어요.", { exact: true })).toBeVisible()
    const avatar = page.getByRole("img", { name: `${profile.displayName} 프로필 사진` })
    await expect(avatar).toBeVisible()
    await expect(avatar).toHaveAttribute("src", new RegExp(avatarObjectPathSuffix, "u"))
    await expectAvatarSnapshot(session.userId, {
      avatarPath: `profiles/${session.userId}/avatar`,
      objectCount: 1,
    })

    await page.reload()
    await expect(
      page.getByRole("img", { name: `${profile.displayName} 프로필 사진` }),
    ).toBeVisible()
    await page.goto("/mypage")
    await expect(
      page.getByRole("img", { name: `${profile.displayName} 프로필 사진` }),
    ).toBeVisible()
    await page.goto("/mypage/profile")
    await page.screenshot({
      animations: "disabled",
      path: `.omo/evidence/profile-avatar/${testInfo.project.name}-profile.png`,
    })

    await page.getByRole("button", { name: "사진 삭제" }).click()
    const dialog = page.getByRole("dialog", { name: "프로필 사진을 삭제할까요?" })
    await expect(dialog).toBeVisible()
    await page.screenshot({
      animations: "disabled",
      path: `.omo/evidence/profile-avatar/${testInfo.project.name}-delete-dialog.png`,
    })

    // When: the owner confirms deletion.
    await dialog.getByRole("button", { name: "삭제", exact: true }).click()

    // Then: the profile reference and public object are both removed.
    await expect(page.getByText("프로필 사진을 삭제했어요.", { exact: true })).toBeVisible()
    await expect(
      page.getByRole("img", { name: `${profile.displayName} 프로필 사진 없음` }),
    ).toBeVisible()
    await expectAvatarSnapshot(session.userId, { avatarPath: null, objectCount: 0 })
  } finally {
    if (session) await cleanupProfileEditSession(session)
  }
})

async function expectAvatarSnapshot(
  userId: string,
  expected: Readonly<{ avatarPath: string | null; objectCount: number }>,
): Promise<void> {
  const dbUrl = process.env["SPOLINK_AUTH_E2E_DB_URL"]
  if (!dbUrl) throw new Error("SPOLINK_AUTH_E2E_DB_URL is required.")
  const sql = postgres(dbUrl, { idle_timeout: 1, max: 1 })
  try {
    const [profile] = await sql`
      select avatar_path
      from public.profiles
      where id = ${userId}
    `
    const [storage] = await sql`
      select count(*)::integer as object_count
      from storage.objects
      where bucket_id = 'profile-avatars'
        and name = ${`profiles/${userId}/avatar`}
    `
    expect(profile?.["avatar_path"] ?? null).toBe(expected.avatarPath)
    expect(storage?.["object_count"] ?? -1).toBe(expected.objectCount)
  } finally {
    await sql.end({ timeout: 1 })
  }
}
