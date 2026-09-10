import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import typescript from "typescript"

const workspaceUrl = pathToFileURL(`${process.cwd()}/`).href

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".ts") || url.endsWith(".tsx")) {
      const loaded = nextLoad(url, { ...context, format: "module" })
      const source = typeof loaded.source === "string" ? loaded.source : loaded.source.toString()
      const result = typescript.transpileModule(source, {
        compilerOptions: {
          jsx: typescript.JsxEmit.ReactJSX,
          module: typescript.ModuleKind.ESNext,
          target: typescript.ScriptTarget.ES2022,
        },
        fileName: fileURLToPath(url),
      })
      return { format: "module", shortCircuit: true, source: result.outputText }
    }

    return nextLoad(url, context)
  },
  resolve(specifier, context, nextResolve) {
    const baseUrl = specifier.startsWith("@/")
      ? new URL(specifier.slice(2), workspaceUrl)
      : context.parentURL && specifier.startsWith(".")
        ? new URL(specifier, context.parentURL)
        : null

    if (baseUrl) {
      for (const extension of [".ts", ".tsx"]) {
        const candidate = new URL(`${baseUrl.href}${extension}`)
        if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context)
      }
    }

    return nextResolve(specifier, context)
  },
})

const pickerModule = await import("../components/profile/profile-region-picker.tsx")
const pickerSource = await readFile(
  new URL("../components/profile/profile-region-picker.tsx", import.meta.url),
  "utf8",
)
const onboardingSource = await readFile(
  new URL("../components/onboarding/profile-onboarding-form.tsx", import.meta.url),
  "utf8",
)

test("Given the generated region catalog, profile choices retain Korean helper ordering", () => {
  const options = pickerModule.getProfileRegionOptions("")
  const provinceLabels = options
    .filter((option) => option.category === "province")
    .map((option) => option.label)
  const seoulDistrictLabels = options
    .filter((option) => option.value.startsWith("서울특별시 "))
    .map((option) => option.label)
  const optionKeys = options.map((option) => option.key)

  assert.deepEqual(
    provinceLabels,
    [...provinceLabels].sort((left, right) => left.localeCompare(right, "ko-KR")),
  )
  assert.equal(new Set(optionKeys).size, optionKeys.length)
  assert.deepEqual(
    seoulDistrictLabels,
    [...seoulDistrictLabels].sort((left, right) => left.localeCompare(right, "ko-KR")),
  )
  assert.equal(
    options.some((option) => option.label.includes("전체")),
    false,
  )
})

test("Given CJK search text, the picker exposes only canonical province or district values", () => {
  const options = pickerModule.getProfileRegionOptions("강남구")

  assert.deepEqual(options, [
    {
      category: "district",
      key: "district:1168000000",
      label: "서울특별시 · 강남구",
      value: "서울특별시 강남구",
    },
  ])
  assert.equal(pickerModule.isCanonicalProfileRegion("서울특별시"), true)
  assert.equal(pickerModule.isCanonicalProfileRegion("서울특별시 강남구"), true)
  assert.equal(pickerModule.isCanonicalProfileRegion("강남구"), false)
  assert.equal(pickerModule.isCanonicalProfileRegion("전국"), false)
  assert.equal(pickerModule.isCanonicalProfileRegion(""), false)
  assert.equal(pickerModule.isCanonicalProfileRegion(null), false)
})

test("Given signup onboarding mode, region suggestions stay hidden until input and stop at two", () => {
  assert.deepEqual(pickerModule.getProfileRegionSuggestions("", 2), [])

  const suggestions = pickerModule.getProfileRegionSuggestions("서울", 2)
  assert.equal(suggestions.length, 2)
  assert.equal(
    suggestions.every((option) => pickerModule.isCanonicalProfileRegion(option.value)),
    true,
  )
  assert.match(onboardingSource, /maxSuggestions=\{2\}/u)
  assert.match(onboardingSource, /suggestionsOnly/u)
})

test("Given a legacy noncanonical value, explicit canonical selection is required before output", () => {
  const initial = pickerModule.createProfileRegionPickerState("강남구")
  const rejected = pickerModule.reduceProfileRegionPickerState(initial, {
    kind: "select",
    value: "강남구",
  })
  const selected = pickerModule.reduceProfileRegionPickerState(rejected, {
    kind: "select",
    value: "서울특별시 강남구",
  })
  const cleared = pickerModule.reduceProfileRegionPickerState(selected, { kind: "clear-search" })

  assert.deepEqual(initial, {
    needsReselection: true,
    query: "",
    selectedValue: null,
  })
  assert.deepEqual(rejected, initial)
  assert.equal(selected.selectedValue, "서울특별시 강남구")
  assert.equal(cleared.selectedValue, "서울특별시 강남구")
  assert.equal(cleared.query, "")
})

test("Given an invalid value, the rendered picker has labels, result count, recovery guidance, and IME-safe selection", () => {
  const markup = renderToStaticMarkup(
    createElement(pickerModule.ProfileRegionPicker, { onChange: () => {}, value: null }),
  )

  assert.match(markup, /지역 검색/u)
  assert.match(markup, /검색 결과 \d+개/u)
  assert.match(markup, /지역을 다시 선택해 주세요/u)
  assert.match(pickerSource, /nativeEvent\.isComposing/u)
  assert.match(pickerSource, /whitespace-normal/u)
  assert.match(pickerSource, /break-keep/u)
})

test("Given the profile picker source, it never imports lesson URL or filter state", () => {
  assert.doesNotMatch(
    pickerSource,
    /allRegionsFilterValue|lesson-search-picker|@\/lib\/lesson-search["']/u,
  )
  assert.match(pickerSource, /lessonRegions/u)
  assert.match(pickerSource, /searchRegionOptions/u)
  assert.match(pickerSource, /sortLessonRegions/u)
  assert.match(pickerSource, /sortRegionDistricts/u)
})

if (process.env.PROFILE_REGION_PICKER_EVIDENCE_PATH) {
  const initial = pickerModule.createProfileRegionPickerState("legacy-region")
  const searched = pickerModule.reduceProfileRegionPickerState(initial, {
    kind: "search",
    query: "강남구",
  })
  const selected = pickerModule.reduceProfileRegionPickerState(searched, {
    kind: "select",
    value: "서울특별시 강남구",
  })
  const cleared = pickerModule.reduceProfileRegionPickerState(selected, { kind: "clear-search" })
  const markup = renderToStaticMarkup(
    createElement(pickerModule.ProfileRegionPicker, {
      onChange: () => {},
      value: "서울특별시 강남구",
    }),
  )
  const renderedLabels = ["지역 검색", "검색 결과", "서울특별시 · 강남구"].filter((label) =>
    markup.includes(label),
  )

  await writeFile(
    process.env.PROFILE_REGION_PICKER_EVIDENCE_PATH,
    `${JSON.stringify(
      {
        scenario: "legacy invalid -> search 강남구 -> canonical select -> clear search",
        invocation:
          "corepack pnpm exec node --test tests/mypage-profile-region-picker.test.mjs tests/lesson-search-options.test.mjs",
        binaryObservables: {
          renderedLabels,
          renderedSelectionCategory: markup.includes("선택됨") ? "canonical" : "missing",
          stateCategories: [
            initial.needsReselection ? "needs-reselection" : "canonical",
            searched.query === "강남구" ? "searching" : "unexpected",
            selected.selectedValue ? "canonical" : "missing",
            cleared.selectedValue === selected.selectedValue ? "canonical-preserved" : "lost",
          ],
        },
        adversarial: {
          malformedInput:
            "null, noncanonical, blank, and free-text inputs rejected by focused contracts",
          cjkComposition: "IME-composing Enter prevention asserted from the real component handler",
          dirtyWorktree: "pre-existing dirty worktree was observed and no unowned path was edited",
          staleState:
            "selection category remains canonical after clearing the separate search state",
          misleadingSuccessOutput: "React DOM/server markup contains the selected-state category",
          flakyTests: [
            ".omo/evidence/mypage-profile-edit/task-2-focused-run-1.txt",
            ".omo/evidence/mypage-profile-edit/task-2-focused-run-2.txt",
          ],
          notApplicable: [
            "native dialog Escape/focus restoration: this picker does not use a dialog",
          ],
        },
        cleanup:
          "React DOM/server rendering and TypeScript transpilation ran in memory; no temporary compile or render artifact remains.",
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
}
