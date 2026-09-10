import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const css = await readFile("app/globals.css", "utf8")
const primitives = await readFile("components/ui/form-controls.tsx", "utf8").catch(() => "")

const controlConsumers = Object.freeze([
  "components/auth/auth-fields.tsx",
  "components/coach/coach-application-fields.tsx",
  "components/lessons/coach-lesson-form-fields.tsx",
  "components/lessons/coach-schedule-manager.tsx",
  "components/lessons/lesson-address-search.tsx",
  "components/lessons/lesson-search-picker.tsx",
  "components/lessons/searchable-choice-input.tsx",
  "components/profile/profile-region-picker.tsx",
])

test("Given single-line form controls, when rendered across service forms, then one 48px visual contract applies", async () => {
  assert.match(css, /--control-height: 48px/u)
  assert.match(css, /\.form-control\s*\{[\s\S]*block-size: var\(--control-height\)/u)
  assert.match(css, /border-radius: var\(--radius-sm\)/u)
  assert.match(css, /background: var\(--surface-inset\)/u)

  assert.match(primitives, /export const TextInput/u)
  assert.match(primitives, /export const SelectInput/u)
  assert.match(primitives, /export const TextareaInput/u)

  for (const filePath of controlConsumers) {
    const source = await readFile(filePath, "utf8")
    assert.match(source, /@\/components\/ui\/form-controls/u, filePath)
  }
})

test("Given searchable and multiline controls, when specialized, then only their necessary geometry changes", () => {
  assert.match(css, /\.form-control--search\s*\{[\s\S]*padding-inline-start: 44px/u)
  assert.match(css, /\.form-control--textarea\s*\{[\s\S]*block-size: auto/u)
  assert.match(css, /\.form-control--textarea\s*\{[\s\S]*min-block-size: 128px/u)
})

test("Given long Korean region labels, when options share a narrow two-column panel, then choice rows stay stable", async () => {
  const picker = await readFile("components/profile/profile-region-picker.tsx", "utf8")

  assert.match(css, /--control-choice-height: 64px/u)
  assert.match(css, /\.form-choice\s*\{[\s\S]*min-block-size: var\(--control-height\)/u)
  assert.match(
    css,
    /@media \(min-width: 640px\)[\s\S]*min-block-size: var\(--control-choice-height\)/u,
  )
  assert.match(picker, /form-choice/u)
})
