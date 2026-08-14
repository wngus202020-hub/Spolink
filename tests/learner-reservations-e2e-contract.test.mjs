import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const specPath = "tests/auth-ui-e2e/learner-reservations.spec.ts"
const runnerPath = "tests/auth-ui-e2e/run-learner-reservations.mjs"

test("learner reservation E2E script points only to the guarded focused runner", async () => {
  const packageJson = JSON.parse(await read("package.json"))

  assert.equal(
    packageJson.scripts["test:e2e:reservations"],
    "node tests/auth-ui-e2e/run-learner-reservations.mjs",
  )
})

test("learner reservation runner owns configured lifecycle and both browser projects", async () => {
  const runner = await read(runnerPath)

  assert.match(runner, /withConfiguredAuthMode/u)
  assert.match(runner, /\{ enableConfirmations: false \}/u)
  assert.match(runner, /tests\/auth-ui-e2e\/learner-reservations\.spec\.ts/u)
  assert.match(runner, /--config=playwright\.auth\.config\.ts/u)
  assert.match(runner, /--project=desktop-chromium/u)
  assert.match(runner, /--project=mobile-chromium/u)
  assert.match(runner, /SPOLINK_AUTH_E2E_BASE_URL: baseUrl/u)
  assert.match(runner, /SPOLINK_AUTH_E2E_DB_URL: status\.dbUrl/u)
  assert.match(runner, /SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: rawOutput\.dir/u)
  assert.match(runner, /SPOLINK_VISUAL_QA_DIR/u)
  assert.match(runner, /await rawOutput\.cleanup\(\)/u)
  assert.match(runner, /writeJsonMode600/u)
})

test("learner reservation spec seeds every required owned state and one foreign owner", async () => {
  const spec = await read(specPath)

  for (const status of [
    "pending_payment",
    "confirmed",
    "completed",
    "cancelled_by_user",
    "no_show_user",
    "disputed",
  ]) {
    assert.match(spec, new RegExp(`'${status}'`, "u"))
  }
  assert.match(spec, /futureIso\(1\)/u)
  assert.match(spec, /futureIso\(-1\)/u)
  assert.match(spec, /foreignLearnerUserId/u)
  assert.match(spec, /reservationIds\.foreign/u)
  assert.match(spec, /foreignResponse\?\.status\(\)\)\.toBe\(404\)/u)
  assert.match(spec, /expect\(page\.getByText\(foreignLessonTitle\)\)\.toHaveCount\(0\)/u)
})

test("learner reservation spec covers safe redirects, filters, and guarded payment handoff", async () => {
  const spec = await read(specPath)

  assert.match(spec, /"\/mypage"/u)
  assert.match(spec, /"\/mypage\/reservations"/u)
  assert.match(spec, /`\/mypage\/reservations\/\$\{reservationIds\.foreign\}`/u)
  assert.match(spec, /searchParams\.get\("next"\)\)\.toBe\(route\)/u)
  for (const filter of ["pending", "confirmed", "completed", "cancelled", "no_show", "disputed"]) {
    assert.match(spec, new RegExp(`"${filter}"`, "u"))
  }
  assert.match(spec, /\/reservations\/\$\{reservationIds\.pending\}\/payment/u)
  assert.match(spec, /reservationIds\.expired/u)
  assert.match(
    spec,
    /expect\(page\.getByRole\("link", \{ name: "결제 계속" \}\)\)\.toHaveCount\(0\)/u,
  )
  assert.match(spec, /현재 예약 상태는 취소 요청 대상이에요/u)
  assert.match(spec, /이 화면에서는 취소 요청을 제출할 수 없어요/u)
  assert.match(
    spec,
    /expect\(page\.getByRole\("button", \{ name: \/취소\/u \}\)\)\.toHaveCount\(0\)/u,
  )
})

test("learner reservation spec captures optional evidence and rejects mutation/provider requests", async () => {
  const spec = await read(specPath)

  assert.match(spec, /process\.env\["SPOLINK_VISUAL_QA_DIR"\]/u)
  assert.match(spec, /page\.screenshot\(/u)
  assert.match(spec, /learner-reservations-\$\{label\}-\$\{projectName\}\.png/u)
  assert.match(spec, /\/api\\\/reservations\\\/\[\^\/\]\+\\\/cancel/u)
  assert.match(spec, /url\.pathname === "\/api\/payments\/confirm"/u)
  assert.match(spec, /url\.hostname\.toLowerCase\(\)\.includes\("toss"\)/u)
  assert.match(spec, /expect\(forbiddenRequests\)\.toEqual\(\[\]\)/u)
  assert.doesNotMatch(
    spec,
    /requestPayment|TossPayments|PaymentWidget|\/api\/payments\/confirm["'`]\s*,\s*\{/u,
  )
  assert.doesNotMatch(spec, /as any|@ts-ignore|@ts-expect-error/u)
})

async function read(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), "utf8")
}
