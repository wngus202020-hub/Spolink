export function applyIntervals(source, intervals) {
  if (intervals.length === 0) return source
  intervals.sort((left, right) => left.start - right.start || right.end - left.end)
  const output = []
  let cursor = 0
  for (const interval of intervals) {
    if (interval.start < cursor) continue
    output.push(source.slice(cursor, interval.start), interval.replacement)
    cursor = interval.end
  }
  output.push(source.slice(cursor))
  return output.join("")
}

export function replaceLiteral(source, needle, replacement) {
  let start = source.indexOf(needle)
  if (start < 0) return source
  const output = []
  let cursor = 0
  while (start >= 0) {
    output.push(source.slice(cursor, start), replacement)
    cursor = start + needle.length
    start = source.indexOf(needle, cursor)
  }
  output.push(source.slice(cursor))
  return output.join("")
}

export function skipWhitespace(source, start) {
  let index = start
  while (index < source.length && isWhitespace(source.charCodeAt(index))) index += 1
  return index
}

export function scanUntilDelimiter(source, start, maximumLength) {
  const limit = Math.min(source.length, start + maximumLength)
  let end = start
  while (end < limit && !isUrlDelimiter(source.charCodeAt(end))) end += 1
  return end
}

export function scanCredentialEnd(source, start, maximumLength) {
  const limit = Math.min(source.length, start + maximumLength)
  let end = start
  while (end < limit && isCredentialCharacter(source.charCodeAt(end))) end += 1
  return end
}

export function normalizeName(value) {
  let normalized = ""
  for (const character of value)
    if (isAlphaNumeric(character.charCodeAt(0))) normalized += character.toLowerCase()
  return normalized
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
function isWhitespace(code) {
  return code === 9 || code === 10 || code === 13 || code === 32
}
function isCredentialCharacter(code) {
  return isAlphaNumeric(code) || "._~+/=-".includes(String.fromCharCode(code))
}
function isUrlDelimiter(code) {
  return isWhitespace(code) || code === 34 || code === 39 || code === 92
}
