export function findQuotedEnd(source, start, quote, maximumLength) {
  const limit = Math.min(source.length, start + maximumLength)
  let escaped = false
  for (let index = start; index < limit; index += 1) {
    if (escaped) {
      escaped = false
      continue
    }
    if (source[index] === "\\") {
      escaped = true
      continue
    }
    if (source[index] === quote) return index
  }
  return null
}

export function countLiteral(source, needle) {
  let count = 0
  let cursor = source.indexOf(needle)
  while (cursor >= 0) {
    count += 1
    cursor = source.indexOf(needle, cursor + Math.max(needle.length, 1))
  }
  return count
}

export function parseJson(source) {
  try {
    return JSON.parse(source)
  } catch {
    return null
  }
}

export function isRaw(value) {
  return typeof value === "string" && value.length >= 4 && !value.startsWith("<redacted")
}

export function normalizeName(value) {
  let result = ""
  for (const character of value)
    if (isAlphaNumeric(character.charCodeAt(0))) result += character.toLowerCase()
  return result
}

export function skipWhitespace(source, start) {
  let index = start
  while (index < source.length && [9, 10, 13, 32].includes(source.charCodeAt(index))) index += 1
  return index
}

export function scanUntilDelimiter(source, start, maximumLength) {
  let end = start
  const limit = Math.min(source.length, start + maximumLength)
  while (end < limit && ![9, 10, 13, 32, 34, 39, 92].includes(source.charCodeAt(end))) end += 1
  return end
}

export function scanCredentialEnd(source, start, maximumLength) {
  let end = start
  const limit = Math.min(source.length, start + maximumLength)
  while (end < limit && (isAlphaNumeric(source.charCodeAt(end)) || "._~+/=-".includes(source[end])))
    end += 1
  return end
}

export function isIdentifierStart(code) {
  return isAsciiLetter(code) || code === 36 || code === 95
}
export function isIdentifierPart(code) {
  return isIdentifierStart(code) || isAsciiDigit(code) || code === 45 || code === 46
}
export function isAsciiLetter(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}
export function isAlphaNumeric(code) {
  return isAsciiLetter(code) || isAsciiDigit(code)
}
export function isHex(code) {
  return isAsciiDigit(code) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102)
}
export function isFixtureCharacter(code) {
  return isAlphaNumeric(code) || "!@#$%^&*_.-".includes(String.fromCharCode(code))
}
export function isJwtCharacter(code) {
  return isAlphaNumeric(code) || code === 45 || code === 46 || code === 95
}
export function isEmailLocal(code) {
  return isAlphaNumeric(code) || "._%+-".includes(String.fromCharCode(code))
}
export function isEmailDomain(code) {
  return isAlphaNumeric(code) || code === 45 || code === 46
}
export function isAsciiLetters(value) {
  for (const character of value) if (!isAsciiLetter(character.charCodeAt(0))) return false
  return true
}

function isAsciiDigit(code) {
  return code >= 48 && code <= 57
}
