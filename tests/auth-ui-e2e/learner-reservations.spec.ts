import { test } from "@playwright/test"
import { assertUnauthenticatedReservationRoutes } from "./learner-reservations-route-assertions"
import { runLearnerReservationScenario } from "./learner-reservations-scenario"
import { reservationTestTitles } from "./learner-reservations-scenario-contract"

test(reservationTestTitles.unauthenticated, async ({ page }) => {
  await assertUnauthenticatedReservationRoutes(page)
})

test(reservationTestTitles.learner, async ({ page }, testInfo) => {
  await runLearnerReservationScenario(page, testInfo)
})
