import test from "node:test"

import { runLessonImageLiveScenario } from "./lesson-images/live-scenario.mjs"

test("live lesson image Storage, RLS, API, compensation, and concurrency", {
  timeout: 12 * 60 * 1000,
}, async () => {
  await runLessonImageLiveScenario()
})
