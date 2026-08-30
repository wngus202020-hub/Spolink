import { test } from "@playwright/test"
import { createMypageReviewsScenario } from "./mypage-reviews-scenario"

const reviewApiManifest = {
  create: "/api/reviews",
  hide: (reviewId: string) => `/api/admin/reviews/${reviewId}/hide`,
  public: (lessonId: string) => `/api/lessons/${lessonId}/reviews`,
} as const

test("managed review history preserves ownership, pagination, redirects, public isolation, and recovery", async ({
  page,
}, testInfo) => {
  const { cleanupReviewFixtures, restoreAuthenticatedReviewSelect, run } =
    createMypageReviewsScenario(page, testInfo, reviewApiManifest)
  try {
    await run()
  } finally {
    try {
      await restoreAuthenticatedReviewSelect()
    } finally {
      await cleanupReviewFixtures()
    }
  }
})
