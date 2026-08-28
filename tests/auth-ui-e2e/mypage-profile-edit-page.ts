import { expect, type Locator, type Page, type Request, type Response } from "@playwright/test"
import { z } from "zod"
import type { ProfileSeed } from "./mypage-profile-edit-fixtures"

export const approvedPatchKeys = [
  "defaultRegion",
  "displayName",
  "locationAgreed",
  "marketingAgreed",
  "phone",
  "realName",
] as const

const observedPatchSchema = z.strictObject({
  defaultRegion: z.string().optional(),
  displayName: z.string().optional(),
  locationAgreed: z.boolean().optional(),
  marketingAgreed: z.boolean().optional(),
  phone: z.string().optional(),
  realName: z.string().optional(),
})

export type ObservedPatch = Readonly<z.infer<typeof observedPatchSchema>>

export async function selectCanonicalRegion(
  page: Page,
  query: string,
  optionName: RegExp,
): Promise<void> {
  await regionSearchbox(page).fill(query)
  await expect(page.getByText(/검색 결과 [1-9][0-9]*개/u)).toBeVisible()
  await page.getByRole("button", { name: optionName }).click()
}

export function regionSearchbox(page: Page): Locator {
  return page.getByRole("searchbox", { name: "지역 검색" })
}

export function profileEditAlert(page: Page): Locator {
  return page.locator("[data-profile-edit-shell]").getByRole("alert")
}

export async function setCheckbox(locator: Locator, checked: boolean): Promise<void> {
  if ((await locator.isChecked()) !== checked) await locator.click()
  await expect(locator).toBeChecked({ checked })
}

export async function assertEditedValuesRetained(page: Page, seed: ProfileSeed): Promise<void> {
  await expect(page.getByLabel("활동 이름 (필수)")).toHaveValue(seed.displayName)
  await expect(page.getByLabel("실명 (필수)")).toHaveValue(seed.realName)
  await expect(page.getByLabel("휴대폰 번호 (필수)")).toHaveValue(seed.phone)
  await expect(page.getByLabel("내 주변 레슨 안내를 위한 위치 이용에 동의해요.")).toBeChecked({
    checked: seed.locationAgreed,
  })
  await expect(page.getByLabel("혜택과 새로운 레슨 소식 수신에 동의해요.")).toBeChecked({
    checked: seed.marketingAgreed,
  })
}

export async function waitForProfileRefreshResponse(page: Page): Promise<void> {
  const response = await page.waitForResponse((candidate) => {
    const url = new URL(candidate.url())
    return (
      candidate.request().method() === "GET" &&
      url.pathname === "/mypage/profile" &&
      url.searchParams.has("_rsc")
    )
  })
  await assertResponseFinished(response)
}

export async function assertResponseFinished(response: Response | null): Promise<void> {
  if (response === null) throw new Error("Profile response was not returned.")
  const failure = await response.finished()
  if (failure) throw failure
}

export function parseObservedPatch(request: Request): ObservedPatch {
  const body = request.postData()
  if (!body) throw new Error("Profile edit PATCH body is missing.")
  const parsedJson: unknown = JSON.parse(body)
  const parsed = observedPatchSchema.safeParse(parsedJson)
  if (!parsed.success) throw new Error("Profile edit PATCH contains unexpected keys.")
  return parsed.data
}
