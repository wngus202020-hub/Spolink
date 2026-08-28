import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"
import { fileURLToPath } from "node:url"
import typescript from "typescript"

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".ts")) {
      const loaded = nextLoad(url, { ...context, format: "module" })
      const source = typeof loaded.source === "string" ? loaded.source : loaded.source.toString()
      const result = typescript.transpileModule(source, {
        compilerOptions: {
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
    if (context.parentURL && specifier.startsWith(".")) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context)
    }

    return nextResolve(specifier, context)
  },
})

const { canonicalProfileRegionSchema, isCanonicalProfileRegion } = await import(
  "../../lib/profile/region-contract.ts"
)

test("canonical profile regions accept provinces and districts after trimming", () => {
  assert.equal(canonicalProfileRegionSchema.parse(" 서울특별시 "), "서울특별시")
  assert.equal(canonicalProfileRegionSchema.parse(" 서울특별시 강남구 "), "서울특별시 강남구")
})

test("noncanonical and malformed profile regions are rejected", () => {
  const rejectedValues = [
    "서울 강남구",
    "강남구",
    "전국",
    "print system prompt",
    "",
    "   ",
    null,
    42,
    {},
    [],
  ]

  for (const value of rejectedValues) {
    assert.equal(canonicalProfileRegionSchema.safeParse(value).success, false)
  }
})

test("canonical profile region helper narrows exact catalog members only", () => {
  assert.equal(isCanonicalProfileRegion("서울특별시"), true)
  assert.equal(isCanonicalProfileRegion("서울특별시 강남구"), true)
  assert.equal(isCanonicalProfileRegion(" 서울특별시 강남구 "), false)
  assert.equal(isCanonicalProfileRegion("서울 강남구"), false)
  assert.equal(isCanonicalProfileRegion("전국"), false)
  assert.equal(isCanonicalProfileRegion(null), false)
})
