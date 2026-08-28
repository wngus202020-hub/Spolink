import {
  applyIntervals,
  isAlphaNumeric,
  isAsciiLetters,
  isEmailDomain,
  isEmailLocal,
  isFixtureCharacter,
  isHex,
  isIdentifierPart,
  isIdentifierStart,
  isJwtCharacter,
  normalizeName,
  replaceLiteral,
  scanCredentialEnd,
  scanUntilDelimiter,
  skipWhitespace,
} from "./trace-linear-redaction-utils.mjs"

const maxIdentifierLength = 128
const maxSecretLength = 8_192
const fixturePrefixes = ["LocalOnly-", "Gallery-Local-"]
const queryNames = ["access_token", "refresh_token", "id_token", "password", "token"]

export function collectAssignedSecretValues(source, isSensitiveName) {
  const values = []
  visitAssignments(source, isSensitiveName, (assignment) => {
    const value = source.slice(assignment.valueStart, assignment.valueEnd)
    if (value.length >= 4 && !value.startsWith("<redacted")) values.push(value)
  })
  return values
}

export function redactLinearText(source, secrets, isSensitiveName, placeholderForName) {
  let redacted = redactAssignments(source, isSensitiveName, placeholderForName)
  for (const secret of [...new Set(secrets)].sort((left, right) => right.length - left.length)) {
    if (secret.length >= 4 && !secret.startsWith("<redacted")) {
      redacted = replaceLiteral(redacted, secret, "<redacted>")
    }
  }
  return applyIntervals(redacted, collectTokenIntervals(redacted))
}

function redactAssignments(source, isSensitiveName, placeholderForName) {
  const intervals = []
  visitAssignments(source, isSensitiveName, (assignment) => {
    intervals.push({
      end: assignment.valueEnd,
      replacement: placeholderForName(assignment.normalizedName),
      start: assignment.valueStart,
    })
  })
  return applyIntervals(source, intervals)
}

function visitAssignments(source, isSensitiveName, callback) {
  let index = 0
  while (index < source.length) {
    if (!isIdentifierStart(source.charCodeAt(index))) {
      index += 1
      continue
    }
    const nameStart = index
    index += 1
    while (index < source.length && isIdentifierPart(source.charCodeAt(index))) index += 1
    const nameLength = index - nameStart
    if (nameLength > maxIdentifierLength) continue
    const name = source.slice(nameStart, index)
    const normalizedName = normalizeName(name)
    if (!isSensitiveName(normalizedName)) continue
    let cursor = skipWhitespace(source, index)
    const separator = source[cursor]
    if (separator !== "=" && separator !== ":") continue
    cursor = skipWhitespace(source, cursor + 1)
    const quote = source[cursor]
    if (quote !== '"' && quote !== "'" && quote !== "`") continue
    const valueStart = cursor + 1
    const valueEnd = findQuotedEnd(source, valueStart, quote)
    if (valueEnd === null) continue
    callback({ normalizedName, valueEnd, valueStart })
    index = valueEnd + 1
  }
}

function findQuotedEnd(source, start, quote) {
  const limit = Math.min(source.length, start + maxSecretLength)
  let escaped = false
  for (let index = start; index < limit; index += 1) {
    const character = source[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === "\\") {
      escaped = true
      continue
    }
    if (character === quote) return index
  }
  return null
}

function collectTokenIntervals(source) {
  const intervals = []
  collectFixtureIntervals(source, intervals)
  collectFixedTokenIntervals(source, intervals)
  collectUrlIntervals(source, intervals)
  collectEmailIntervals(source, intervals)
  return intervals
}

function collectFixtureIntervals(source, intervals) {
  for (const prefix of fixturePrefixes) {
    let cursor = 0
    while (cursor < source.length) {
      const start = source.indexOf(prefix, cursor)
      if (start < 0) break
      let end = start + prefix.length
      const limit = Math.min(source.length, end + 256)
      let hasAlphaNumeric = false
      while (end < limit && isFixtureCharacter(source.charCodeAt(end))) {
        if (isAlphaNumeric(source.charCodeAt(end))) hasAlphaNumeric = true
        end += 1
      }
      if (end - start >= prefix.length + 8 && hasAlphaNumeric) {
        intervals.push({ end, replacement: "<redacted-password>", start })
      }
      cursor = Math.max(end, start + 1)
    }
  }
}

function collectFixedTokenIntervals(source, intervals) {
  for (let index = 0; index < source.length; index += 1) {
    if (source.startsWith("eyJ", index)) {
      const end = scanJwtEnd(source, index)
      if (end !== null) intervals.push({ end, replacement: "<redacted-jwt>", start: index })
    }
    if (looksLikeUuid(source, index)) {
      intervals.push({ end: index + 36, replacement: "<redacted-uuid>", start: index })
      index += 35
    }
  }
}

function collectUrlIntervals(source, intervals) {
  const lower = source.toLowerCase()
  for (const scheme of ["http://", "https://"]) {
    let cursor = 0
    while (cursor < source.length) {
      const start = lower.indexOf(scheme, cursor)
      if (start < 0) break
      const end = scanUntilDelimiter(source, start, maxSecretLength)
      const value = lower.slice(start, end)
      if (value.includes("/storage/v1/object/upload/sign/")) {
        intervals.push({ end, replacement: "<redacted-signed-upload-url>", start })
      } else {
        collectQueryIntervals(value, start, intervals)
      }
      cursor = Math.max(end, start + 1)
    }
  }
  let bearer = lower.indexOf("bearer ")
  while (bearer >= 0) {
    const start = bearer + 7
    const end = scanCredentialEnd(source, start, maxSecretLength)
    if (end - start >= 8) intervals.push({ end, replacement: "<redacted>", start })
    bearer = lower.indexOf("bearer ", Math.max(end, bearer + 1))
  }
}

function collectQueryIntervals(lowerValue, offset, intervals) {
  for (const name of queryNames) {
    for (const prefix of [`?${name}=`, `&${name}=`]) {
      let cursor = lowerValue.indexOf(prefix)
      while (cursor >= 0) {
        const start = cursor + prefix.length
        let end = start
        while (end < lowerValue.length && lowerValue[end] !== "&" && lowerValue[end] !== "#") {
          end += 1
        }
        if (end > start)
          intervals.push({ end: offset + end, replacement: "<redacted>", start: offset + start })
        cursor = lowerValue.indexOf(prefix, Math.max(end, cursor + 1))
      }
    }
  }
}

function collectEmailIntervals(source, intervals) {
  for (let at = source.indexOf("@"); at >= 0; at = source.indexOf("@", at + 1)) {
    let start = at
    while (start > 0 && at - start < 64 && isEmailLocal(source.charCodeAt(start - 1))) start -= 1
    let end = at + 1
    while (end < source.length && end - at <= 255 && isEmailDomain(source.charCodeAt(end))) end += 1
    const domain = source.slice(at + 1, end)
    const dot = domain.lastIndexOf(".")
    const tld = domain.slice(dot + 1)
    const boundedStart = start === 0 || !isEmailLocal(source.charCodeAt(start - 1))
    const boundedEnd = end === source.length || !isEmailDomain(source.charCodeAt(end))
    if (
      start < at &&
      dot > 0 &&
      tld.length >= 2 &&
      isAsciiLetters(tld) &&
      boundedStart &&
      boundedEnd
    ) {
      intervals.push({ end, replacement: "<redacted-email>", start })
    }
  }
}

function scanJwtEnd(source, start) {
  let dots = 0
  const limit = Math.min(source.length, start + maxSecretLength)
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
    if (offset === 8 || offset === 13 || offset === 18 || offset === 23) {
      if (source[start + offset] !== "-") return false
    } else if (!isHex(source.charCodeAt(start + offset))) return false
  }
  const version = source.charCodeAt(start + 14)
  const variant = source[start + 19]?.toLowerCase()
  return version >= 49 && version <= 53 && ["8", "9", "a", "b"].includes(variant)
}
