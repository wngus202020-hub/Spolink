import {
  countLiteral,
  findQuotedEnd,
  isAlphaNumeric,
  isAsciiLetters,
  isEmailDomain,
  isEmailLocal,
  isFixtureCharacter,
  isHex,
  isIdentifierPart,
  isIdentifierStart,
  isJwtCharacter,
  isRaw,
  normalizeName,
  parseJson,
  scanCredentialEnd,
  scanUntilDelimiter,
  skipWhitespace,
} from "./trace-linear-security-utils.mjs"

export const securityCategories = [
  "email",
  "jwt",
  "uuid",
  "named-secret",
  "query-secret",
  "bearer",
  "sensitive-header",
  "signed-upload-url",
  "fixture-password",
  "source-secret-assignment",
  "explicit-value",
]

const maxIdentifierLength = 128
const maxValueLength = 8_192
const sensitiveParts = [
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "cookie",
  "email",
  "userid",
]
const queryNames = ["access_token", "refresh_token", "id_token", "password", "token"]
const structuredSensitiveNames = new Set([
  "accesstoken",
  "anonkey",
  "apikey",
  "authorization",
  "cookie",
  "email",
  "idtoken",
  "password",
  "refreshtoken",
  "servicekey",
  "setcookie",
  "token",
  "uploadtoken",
  "uploadurl",
])

export function scanSecurityText(source, forbiddenValues = []) {
  const counts = Object.fromEntries(securityCategories.map((category) => [category, 0]))
  for (const value of forbiddenValues.filter((item) => item.length > 0)) {
    counts["explicit-value"] += countLiteral(source, value)
  }
  scanStructured(source, counts)
  scanAssignments(source, counts)
  scanFixtures(source, counts)
  scanFixedTokens(source, counts)
  scanUrlsAndHeaders(source, counts)
  return counts
}

function scanStructured(source, counts) {
  const parsed = parseJson(source)
  if (parsed !== null) {
    visitParsed(parsed, null, counts)
    return
  }
  for (const line of source.split("\n")) {
    const parsedLine = parseJson(line)
    if (parsedLine !== null) visitParsed(parsedLine, null, counts)
  }
}

function visitParsed(value, key, counts) {
  const normalizedKey = key === null ? null : normalizeName(key)
  if (normalizedKey !== null && structuredSensitiveNames.has(normalizedKey)) {
    if (typeof value === "string" && isRaw(value)) counts["named-secret"] += 1
    return
  }
  if (typeof value === "string") {
    const nested = parseJson(value)
    if (nested !== null && typeof nested === "object") visitParsed(nested, null, counts)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) visitParsed(item, null, counts)
    return
  }
  if (value === null || typeof value !== "object") return
  const headerName = typeof value.name === "string" ? normalizeName(value.name) : null
  if (headerName !== null && isSensitiveName(headerName) && isRaw(value.value)) {
    counts["sensitive-header"] += 1
  }
  for (const [entryKey, entryValue] of Object.entries(value)) {
    visitParsed(entryValue, entryKey, counts)
  }
}

function scanAssignments(source, counts) {
  let index = 0
  while (index < source.length) {
    if (!isIdentifierStart(source.charCodeAt(index))) {
      index += 1
      continue
    }
    const start = index
    index += 1
    while (index < source.length && isIdentifierPart(source.charCodeAt(index))) index += 1
    if (index - start > maxIdentifierLength) continue
    if (!isSensitiveName(normalizeName(source.slice(start, index)))) continue
    let cursor = skipWhitespace(source, index)
    if (source[cursor] !== "=" && source[cursor] !== ":") continue
    cursor = skipWhitespace(source, cursor + 1)
    const quote = source[cursor]
    if (quote !== '"' && quote !== "'" && quote !== "`") continue
    const end = findQuotedEnd(source, cursor + 1, quote, maxValueLength)
    if (end === null) continue
    if (isRaw(source.slice(cursor + 1, end))) counts["source-secret-assignment"] += 1
    index = end + 1
  }
}

function scanFixtures(source, counts) {
  for (const prefix of ["LocalOnly-", "Gallery-Local-"]) {
    let cursor = source.indexOf(prefix)
    while (cursor >= 0) {
      let end = cursor + prefix.length
      const limit = Math.min(source.length, end + 256)
      let alphaNumeric = 0
      while (end < limit && isFixtureCharacter(source.charCodeAt(end))) {
        if (isAlphaNumeric(source.charCodeAt(end))) alphaNumeric += 1
        end += 1
      }
      if (end - cursor >= prefix.length + 8 && alphaNumeric > 0) {
        counts["fixture-password"] += 1
      }
      cursor = source.indexOf(prefix, Math.max(end, cursor + 1))
    }
  }
}

function scanFixedTokens(source, counts) {
  for (let index = 0; index < source.length; index += 1) {
    if (source.startsWith("eyJ", index) && scanJwtEnd(source, index) !== null) counts.jwt += 1
    if (looksLikeUuid(source, index)) {
      counts.uuid += 1
      index += 35
    }
    if (source[index] === "@" && looksLikeEmail(source, index)) counts.email += 1
  }
}

function scanUrlsAndHeaders(source, counts) {
  const lower = source.toLowerCase()
  let bearer = lower.indexOf("bearer ")
  while (bearer >= 0) {
    const start = bearer + 7
    const end = scanCredentialEnd(source, start, maxValueLength)
    if (end - start >= 8 && !source.startsWith("<redacted", start)) counts.bearer += 1
    bearer = lower.indexOf("bearer ", Math.max(end, bearer + 1))
  }
  for (const scheme of ["http://", "https://"]) {
    let cursor = lower.indexOf(scheme)
    while (cursor >= 0) {
      const end = scanUntilDelimiter(source, cursor, maxValueLength)
      const url = lower.slice(cursor, end)
      if (url.includes("/storage/v1/object/upload/sign/") && !url.includes("<redacted")) {
        counts["signed-upload-url"] += 1
      }
      for (const name of queryNames) {
        counts["query-secret"] += countRawQueryValues(url, name)
      }
      cursor = lower.indexOf(scheme, Math.max(end, cursor + 1))
    }
  }
}

function countRawQueryValues(url, name) {
  let count = 0
  for (const prefix of [`?${name}=`, `&${name}=`]) {
    let cursor = url.indexOf(prefix)
    while (cursor >= 0) {
      const start = cursor + prefix.length
      let end = start
      while (end < url.length && url[end] !== "&" && url[end] !== "#") end += 1
      if (end > start && !url.startsWith("<redacted", start)) count += 1
      cursor = url.indexOf(prefix, Math.max(end, cursor + 1))
    }
  }
  return count
}

function looksLikeEmail(source, at) {
  let start = at
  while (start > 0 && at - start < 64 && isEmailLocal(source.charCodeAt(start - 1))) start -= 1
  let end = at + 1
  while (end < source.length && end - at <= 255 && isEmailDomain(source.charCodeAt(end))) end += 1
  const domain = source.slice(at + 1, end)
  const dot = domain.lastIndexOf(".")
  const tld = domain.slice(dot + 1)
  const boundedStart = start === 0 || !isEmailLocal(source.charCodeAt(start - 1))
  const boundedEnd = end === source.length || !isEmailDomain(source.charCodeAt(end))
  return (
    start < at && dot > 0 && tld.length >= 2 && isAsciiLetters(tld) && boundedStart && boundedEnd
  )
}

function scanJwtEnd(source, start) {
  let dots = 0
  const limit = Math.min(source.length, start + maxValueLength)
  let end = start
  while (end < limit && isJwtCharacter(source.charCodeAt(end))) {
    if (source[end] === ".") dots += 1
    end += 1
  }
  return dots === 2 && end - start >= 12 ? end : null
}

function looksLikeUuid(source, start) {
  if (start + 36 > source.length) return false
  if (start > 0 && isHex(source.charCodeAt(start - 1))) return false
  if (start + 36 < source.length && isHex(source.charCodeAt(start + 36))) return false
  for (let offset = 0; offset < 36; offset += 1) {
    if ([8, 13, 18, 23].includes(offset)) {
      if (source[start + offset] !== "-") return false
    } else if (!isHex(source.charCodeAt(start + offset))) return false
  }
  const version = source.charCodeAt(start + 14)
  const variant = source[start + 19]?.toLowerCase()
  return version >= 49 && version <= 53 && ["8", "9", "a", "b"].includes(variant)
}

const isSensitiveName = (name) => sensitiveParts.some((part) => name.includes(part))
