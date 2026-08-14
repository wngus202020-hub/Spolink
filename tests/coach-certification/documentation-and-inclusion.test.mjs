import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const documents = {
  api: "SPOLINK_API_명세서.md",
  design: "SPOLINK_디자인_시스템.md",
  erd: "SPOLINK_ERD.md",
  policy: "SPOLINK_서비스_정책서.md",
  screen: "SPOLINK_화면_설계.md",
}

test("coach certification documents state the implemented private-file and status contracts", async () => {
  const entries = await Promise.all(
    Object.entries(documents).map(async ([name, file]) => [name, await readFile(file, "utf8")]),
  )
  const docs = Object.fromEntries(entries)

  assert.match(docs.policy, /PNG, JPEG, PDF/u)
  assert.match(docs.policy, /10MB/u)
  assert.match(docs.policy, /보관·삭제 정책은 후속 정책/u)
  assert.match(docs.erd, /private bucket/u)
  assert.match(docs.erd, /<user-id>\/<server-generated-uuid>.*png\|jpg\|pdf/u)
  assert.match(docs.api, /certificate-upload-url/u)
  assert.match(docs.api, /objectName/u)
  assert.match(docs.api, /expiresIn.*300/u)
  assert.match(docs.api, /DELETE \/api\/coach-profile\/me\/certificates/u)
  assert.match(docs.api, /GET \/api\/admin\/coach-profiles\/\{coachProfileId\}/u)
  assert.match(docs.api, /GET \/api\/admin\/coach-profiles\/\{coachProfileId\}\/certificates/u)
  assert.match(docs.screen, /certificate-upload-url/u)
  assert.match(docs.screen, /1280×800/u)
  assert.match(docs.screen, /390×844/u)
  assert.match(docs.design, /PNG\/JPEG\/PDF/u)
  assert.match(docs.design, /300초/u)
})

test("package aggregates and owned runners include all certification contracts and live flows", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"))
  const authRunner = `${await readFile("tests/auth-ui-e2e/run-coach-certification.mjs", "utf8")}\n${await readFile("tests/auth-ui-e2e/run-coach-applicant.mjs", "utf8")}`
  const supabaseRunner = await readFile("tests/supabase-e2e/task8/orchestrator.mjs", "utf8")

  const apiLifecycle = await readFile("tests/auth-ui-e2e/lifecycle.mjs", "utf8")
  assert.match(packageJson.scripts["test:api"], /run-api-tests\.mjs/u)
  assert.match(
    packageJson.scripts["test:api:contracts"],
    /tests\/coach-certification\/\*\.test\.mjs/u,
  )
  assert.match(packageJson.scripts["test:api:contracts"], /tests\/profile-api\/\*\.test\.mjs/u)
  assert.match(apiLifecycle, /\["pnpm", "test:api:contracts"\]/u)
  assert.match(packageJson.scripts["test:e2e:auth"], /run-coach-certification\.mjs/u)
  assert.match(authRunner, /coach-apply\.spec\.ts/u)
  assert.match(authRunner, /coach-application-status\.spec\.ts/u)
  assert.match(authRunner, /admin-coach-review\.spec\.ts/u)
  assert.match(authRunner, /SPOLINK_COACH_CERTIFICATION_INJECT_FAILURE/u)
  assert.match(supabaseRunner, /storage-e2e\.mjs/u)
  assert.match(supabaseRunner, /submission-e2e\.mjs/u)
  assert.match(supabaseRunner, /admin-review-e2e\.mjs/u)
})
