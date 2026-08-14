import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const pagePath = "app/coach/apply/page.tsx"

test("coach application replaces the placeholder and keeps the shared auth gates", async () => {
  const page = await read(pagePath)

  assert.doesNotMatch(page, /ComingSoonPage/u)
  assert.match(page, /readPageAuthProfile\(\)/u)
  assert.match(page, /auth\.kind === "unauthenticated" \|\| auth\.kind === "unconfigured"/u)
  assert.match(page, /redirect\("\/auth\/login\?next=\/coach\/apply"\)/u)
  assert.match(page, /auth\.kind === "profile_required"/u)
  assert.match(page, /redirect\("\/onboarding\/profile"\)/u)
  assert.match(page, /<PublicHeader auth=\{auth\} \/>/u)
})

test("coach application renders the controlled Todo 3 form", async () => {
  const page = await read(pagePath)
  const form = await readCoachForm()

  assert.match(form, /CoachApplicationForm/u)
  assert.match(page, /CoachApplicationForm/u)
  assert.match(page, /href="\/onboarding\/profile"/u)
  assert.match(page, /auth\.profile\.real_name \?\? auth\.profile\.display_name/u)
  assert.match(page, /auth\.profile\.phone \?\? "프로필에서 확인 필요"/u)
  assert.match(form, /<form/u)
  assert.match(form, /value=\{/u)
  assert.match(form, /onChange=\{/u)
  assert.match(form, /type="file"/u)
  assert.match(form, /accept="image\/png,image\/jpeg,application\/pdf"/u)
})

test("coach application exposes draft save, upload, submit, list, and owner delete behavior", async () => {
  const form = await readCoachForm()

  assert.match(form, /saveCoachApplication/u)
  assert.match(form, /createCertificateUpload/u)
  assert.match(form, /registerCoachCertificate/u)
  assert.match(form, /deleteCoachCertificate/u)
  assert.match(form, /certificates\.map/u)
  assert.match(form, /임시 저장/u)
  assert.match(form, /submitCoachApplication/u)
  assert.match(form, /심사 제출/u)
})

test("coach application keeps non-editable states read-only", async () => {
  const form = await readCoachForm()

  assert.match(form, /isCoachCertificationEditable/u)
  assert.match(form, /readOnly=\{!editable\}/u)
  assert.match(form, /disabled=\{[^}]*!editable/u)
})

test("coach application uses existing tokens and 44px control targets", async () => {
  const source = `${await read(pagePath)}\n${await readCoachForm()}`
  const touchTargetClasses = source.match(/min-h-11/gu) ?? []

  assert.ok(touchTargetClasses.length >= 4)
  assert.match(source, /min-h-11/u)
  assert.match(source, /rounded-\[var\(--radius-(?:sm|md|lg|xl)\)\]/u)
  assert.match(source, /from "lucide-react"/u)
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b/iu)
})

test("coach application sends submission through the server-owned transition endpoint", async () => {
  const form = await readCoachForm()

  assert.match(form, /submitCoachApplication/u)
  assert.match(
    await read("lib/coach-certification/applicant-client.ts"),
    /\/api\/coach-profile\/me\/submit/u,
  )
})

async function read(path) {
  try {
    return await readFile(new URL(`../${path}`, import.meta.url), "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return ""
    throw error
  }
}

async function readCoachForm() {
  return `${await read("components/coach/coach-application-form.tsx")}\n${await read(
    "components/coach/coach-application-fields.tsx",
  )}\n${await read("components/coach/coach-certificate-panel.tsx")}`
}
