import { expect, test } from "@playwright/test"

import { cleanupTrustSafetyFixture, createTrustSafetyFixture, login } from "./trust-safety-helpers"

test("managed coach completion accepts browser origin and rejects attacker origin", async ({
  page,
  request,
}, testInfo) => {
  const fixture = await createTrustSafetyFixture(testInfo)
  try {
    await login(page, fixture.coachEmail, "/coach/reservations")
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/reservations/${fixture.confirmedReservationId}/complete`) &&
        response.request().method() === "POST",
    )

    await page.getByRole("button", { name: "수업 완료" }).click()
    const completion = await responsePromise
    expect(completion.status()).toBe(200)
    await expect(page.getByText("예약 상태: completed", { exact: true })).toBeVisible()
    await expect(page.getByText("처리된 예약", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "수업 완료" })).toHaveCount(0)

    const screenshotPath = process.env["SPOLINK_8R_SCREENSHOT_PATH"]
    if (screenshotPath) {
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" })
      await page.locator("main").screenshot({ path: screenshotPath })
    }

    const crossOrigin = await request.post(
      `/api/reservations/${fixture.confirmedReservationId}/complete`,
      {
        data: {},
        headers: { origin: "https://attacker.example" },
      },
    )
    const crossOriginBody: unknown = await crossOrigin.json()
    expect(crossOrigin.status()).toBe(403)
    expect(crossOriginBody).toEqual({
      error: {
        code: "FORBIDDEN",
        details: [],
        message: "Same-origin request required.",
      },
    })

    console.log(
      JSON.stringify({
        completionStatus: completion.status(),
        crossOriginStatus: crossOrigin.status(),
        event: "8r-manual-qa",
        visibleState: "completed-and-processed",
      }),
    )
  } finally {
    await cleanupTrustSafetyFixture(fixture)
  }
})
