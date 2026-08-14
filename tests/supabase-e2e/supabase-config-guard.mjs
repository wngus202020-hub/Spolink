import { readFile } from "node:fs/promises"
import process from "node:process"

import { parse } from "@iarna/toml"

const allowedDelta = new Map([
  ["api.schemas", { from: ["public", "graphql_public"], to: ["public"] }],
  ["api.auto_expose_new_tables", { from: undefined, to: true }],
  ["db.seed.enabled", { from: true, to: false }],
])

const finalAssertions = new Map([
  ["project_id", "spolink"],
  ["api.enabled", true],
  ["api.port", 54321],
  ["api.schemas", ["public"]],
  ["api.extra_search_path", ["public", "extensions"]],
  ["api.max_rows", 1000],
  ["api.auto_expose_new_tables", true],
  ["db.port", 54322],
  ["db.shadow_port", 54320],
  ["db.migrations.enabled", true],
  ["db.seed.enabled", false],
  ["realtime.enabled", true],
  ["studio.enabled", true],
  ["studio.port", 54323],
  ["local_smtp.enabled", true],
  ["local_smtp.port", 54324],
  ["storage.enabled", true],
  ["auth.enabled", true],
  ["edge_runtime.enabled", true],
  ["analytics.enabled", true],
  ["analytics.port", 54327],
])

export async function diffConfigFiles(beforePath, afterPath) {
  const beforeText = await readFile(beforePath, "utf8")
  const afterText = await readFile(afterPath, "utf8")
  return diffConfigText(beforeText, afterText)
}

export function diffConfigText(beforeText, afterText) {
  assertNoDuplicateActiveToml(beforeText, "before")
  assertNoDuplicateActiveToml(afterText, "after")

  const before = parse(beforeText)
  const after = parse(afterText)
  const beforeFlat = flattenObject(before)
  const afterFlat = flattenObject(after)
  const beforePaths = new Set(beforeFlat.keys())

  for (const path of afterFlat.keys()) {
    if (!beforePaths.has(path) && !allowedDelta.has(path)) {
      throw new Error(`Unknown active config key in generated delta: ${path}`)
    }
  }

  const allPaths = new Set([...beforeFlat.keys(), ...afterFlat.keys()])
  for (const path of allPaths) {
    const beforeValue = beforeFlat.get(path)
    const afterValue = afterFlat.get(path)
    if (sameValue(beforeValue, afterValue)) {
      continue
    }

    const expected = allowedDelta.get(path)
    if (
      !expected ||
      !sameValue(beforeValue, expected.from) ||
      !sameValue(afterValue, expected.to)
    ) {
      throw new Error(`Unexpected config delta at ${path}`)
    }
  }

  for (const [path, expected] of allowedDelta) {
    if (
      !sameValue(beforeFlat.get(path), expected.from) ||
      !sameValue(afterFlat.get(path), expected.to) ||
      sameValue(beforeFlat.get(path), afterFlat.get(path))
    ) {
      throw new Error(`Required config delta missing at ${path}`)
    }
  }

  for (const [path, expected] of finalAssertions) {
    const actual = afterFlat.get(path)
    if (!sameValue(actual, expected)) {
      throw new Error(`Final config assertion failed for ${path}`)
    }
  }

  return { changedPaths: [...allowedDelta.keys()] }
}

export function assertFinalConfigText(configText) {
  assertNoDuplicateActiveToml(configText, "config")
  const parsed = parse(configText)
  const flat = flattenObject(parsed)
  for (const [path, expected] of finalAssertions) {
    if (!sameValue(flat.get(path), expected)) {
      throw new Error(`Final config assertion failed for ${path}`)
    }
  }
  return parsed
}

export function parseFinalConfigText(configText) {
  return assertFinalConfigText(configText)
}

export function assertNoDuplicateActiveToml(tomlText, label = "config") {
  let section = ""
  const sections = new Set([""])
  const keysBySection = new Map([["", new Set()]])

  for (const [index, rawLine] of tomlText.split(/\r?\n/).entries()) {
    const line = stripInlineComment(rawLine).trim()
    if (!line) {
      continue
    }

    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      section = sectionMatch[1].trim()
      if (sections.has(section)) {
        throw new Error(
          `${label} has duplicate active TOML section [${section}] at line ${index + 1}`,
        )
      }
      sections.add(section)
      keysBySection.set(section, new Set())
      continue
    }

    const keyMatch = line.match(/^([A-Za-z0-9_-]+)\s*=/)
    if (!keyMatch) {
      continue
    }
    const key = keyMatch[1]
    const keys = keysBySection.get(section) ?? new Set()
    if (keys.has(key)) {
      throw new Error(
        `${label} has duplicate active TOML key ${section ? `${section}.` : ""}${key}`,
      )
    }
    keys.add(key)
    keysBySection.set(section, keys)
  }
}

function flattenObject(value, prefix = "") {
  const result = new Map()
  if (!isPlainObject(value)) {
    result.set(prefix, value)
    return result
  }
  for (const [key, entryValue] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(entryValue)) {
      for (const [childPath, childValue] of flattenObject(entryValue, path)) {
        result.set(childPath, childValue)
      }
      continue
    }
    result.set(path, entryValue)
  }
  return result
}

function stripInlineComment(line) {
  let inSingleQuote = false
  let inDoubleQuote = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const previous = line[index - 1]
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
    } else if (char === '"' && !inSingleQuote && previous !== "\\") {
      inDoubleQuote = !inDoubleQuote
    } else if (char === "#" && !inSingleQuote && !inDoubleQuote) {
      return line.slice(0, index)
    }
  }
  return line
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isPlainObject(value) {
  return (
    value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
  )
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [command, beforePath, afterPath] = process.argv.slice(2)
  if (command !== "diff" || !beforePath || !afterPath) {
    console.error("usage: node tests/supabase-e2e/supabase-config-guard.mjs diff <before> <after>")
    process.exit(2)
  }

  diffConfigFiles(beforePath, afterPath)
    .then((result) => {
      console.log(JSON.stringify(result))
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    })
}
