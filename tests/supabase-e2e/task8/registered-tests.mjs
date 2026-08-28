export const coreNodeTestFiles = [
  "tests/coach-certification/storage-e2e.mjs",
  "tests/coach-certification/submission-e2e.mjs",
  "tests/coach-certification/admin-review-e2e.mjs",
]

export const configuredE2eTestFiles = [
  "tests/supabase-e2e/cancellation-api.test.mjs",
  "tests/supabase-e2e/cancellation-policy.test.mjs",
  "tests/supabase-e2e/cancellation-concurrency.test.mjs",
  "tests/supabase-e2e/reservation-lifecycle-api.test.mjs",
  "tests/supabase-e2e/reservation-lifecycle.test.mjs",
  "tests/supabase-e2e/lesson-images.test.mjs",
]

export function createE2eControls(baseUrl) {
  const controls = { baseUrl }
  const forceLockTimeout = process.env.SPOLINK_E2E_FORCE_LOCK_TIMEOUT
  if (typeof forceLockTimeout === "string" && forceLockTimeout) {
    controls.SPOLINK_E2E_FORCE_LOCK_TIMEOUT = forceLockTimeout
  }
  const task3AttemptDir = process.env.SPOLINK_TASK3_ATTEMPT_DIR
  if (typeof task3AttemptDir === "string" && task3AttemptDir) {
    controls.SPOLINK_TASK3_ATTEMPT_DIR = task3AttemptDir
  }
  return controls
}
