import { parse } from "@iarna/toml"

const authDeltas = new Set([
  "auth.additional_redirect_urls",
  "auth.email.enable_confirmations",
  "auth.site_url",
])

export function assertAuthConfigDelta(beforeText, afterText, expected) {
  const before = flatten(parse(beforeText))
  const after = flatten(parse(afterText))
  const allPaths = new Set([...before.keys(), ...after.keys()])
  for (const key of allPaths) {
    const changed = JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key))
    if (changed && !authDeltas.has(key)) throw new Error(`Unexpected auth config delta: ${key}`)
  }
  assertExpectedValue(after, "auth.site_url", expected.baseUrl)
  assertExpectedValue(after, "auth.additional_redirect_urls", [
    `${expected.baseUrl}/auth/callback`,
    `${expected.baseUrl}/auth/callback?next=/auth/update-password`,
  ])
  assertExpectedValue(after, "auth.email.enable_confirmations", expected.enableConfirmations)
  return { changedPaths: [...authDeltas].sort() }
}

export function rewriteAuthConfig(text, { baseUrl, enableConfirmations }) {
  let next = replaceSectionValue(text, "auth", "site_url", JSON.stringify(baseUrl))
  next = replaceSectionValue(
    next,
    "auth",
    "additional_redirect_urls",
    `[${JSON.stringify(`${baseUrl}/auth/callback`)}, ${JSON.stringify(
      `${baseUrl}/auth/callback?next=/auth/update-password`,
    )}]`,
  )
  return replaceSectionValue(
    next,
    "auth.email",
    "enable_confirmations",
    String(enableConfirmations),
  )
}

function replaceSectionValue(text, sectionName, key, value) {
  const lines = text.split(/\n/)
  let inSection = false
  let replaced = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/)
    if (section) inSection = section[1] === sectionName
    if (!inSection || !new RegExp(`^\\s*${key}\\s*=`).test(line)) continue
    if (replaced) throw new Error(`Duplicate active TOML key ${sectionName}.${key}`)
    lines[index] = `${key} = ${value}`
    replaced = true
  }
  if (!replaced) throw new Error(`Missing active TOML key ${sectionName}.${key}`)
  return lines.join("\n")
}

function assertExpectedValue(flat, key, expected) {
  if (JSON.stringify(flat.get(key)) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected auth config value: ${key}`)
  }
}

function flatten(value, prefix = "") {
  const result = new Map()
  for (const [key, entry] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(entry)) {
      for (const [childKey, childValue] of flatten(entry, fullKey)) result.set(childKey, childValue)
    } else {
      result.set(fullKey, entry)
    }
  }
  return result
}

function isPlainObject(value) {
  return (
    value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
  )
}
