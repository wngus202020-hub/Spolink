import { StringDecoder } from "node:string_decoder"

const outputTailBytes = 16_384
const outputBoundaryCarryChars = 256
const outputAssignmentPattern =
  /(("[^"]{1,128}"|'[^']{1,128}'|[A-Za-z_][A-Za-z0-9_.-]{0,127})\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\]]+)/gu

export function createOutputTail({ preserveOperationalOutput = false } = {}) {
  const decoder = new StringDecoder("utf8")
  let pending = ""
  let tail = Buffer.alloc(0)
  let operationalTail = Buffer.alloc(0)

  function retain(value) {
    const buffer = Buffer.from(redactOutput(value))
    tail = Buffer.concat([tail, buffer]).subarray(-outputTailBytes)
  }

  function drain(final) {
    while (pending) {
      const assignment = findSensitiveAssignment(pending)
      if (assignment) {
        const end = findAssignmentValueEnd(pending, assignment.valueStart)
        if (end === null && !final) {
          retain(pending.slice(0, assignment.start))
          pending = pending.slice(assignment.start)
          return
        }
        retain(pending.slice(0, end ?? pending.length))
        pending = pending.slice(end ?? pending.length)
        continue
      }

      const safeLength = final
        ? pending.length
        : Math.max(0, pending.length - outputBoundaryCarryChars)
      if (safeLength === 0) return
      retain(pending.slice(0, safeLength))
      pending = pending.slice(safeLength)
    }
  }

  return {
    append(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      if (preserveOperationalOutput) {
        operationalTail = Buffer.concat([operationalTail, buffer]).subarray(-outputTailBytes)
      }
      pending += decoder.write(buffer)
      drain(false)
    },
    value(preserve = false) {
      pending += decoder.end()
      drain(true)
      if (preserve && preserveOperationalOutput) {
        return truncateUtf8(operationalTail.toString("utf8"), outputTailBytes)
      }
      return truncateUtf8(tail.toString("utf8"), outputTailBytes)
    },
  }
}

function redactOutput(value) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[REDACTED_EMAIL]")
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu,
      "[REDACTED_ID]",
    )
    .replace(/(?:postgres(?:ql)?):\/\/[^\s]+/giu, "[REDACTED_DB_URL]")
    .replace(/\b(?:local-(?:provider|seed)-\d+)\b/giu, "[REDACTED_PROVIDER_KEY]")
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\b/gu, "[REDACTED_TOKEN]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~-]+/giu, "$1 [REDACTED]")
    .replace(
      /([?&](?:access_token|api[_-]?key|auth(?:orization)?|cookie|id[_-]?token|jwt|refresh[_-]?token|secret|token)=[^&#\s]*)/giu,
      (match) => `${match.slice(0, match.indexOf("=") + 1)}[REDACTED]`,
    )
    .replace(outputAssignmentPattern, (match, prefix, key, value) => {
      if (!isSensitiveDiagnosticKey(key)) return match
      const quote = value[0]
      const redactedValue =
        quote === '"' || quote === "'" ? `${quote}[REDACTED]${quote}` : "[REDACTED]"
      return `${prefix}${redactedValue}`
    })
    .replace(/(?:sb_(?:publishable|secret)_[A-Za-z0-9_-]+)/gu, "[REDACTED_KEY]")
    .replace(/01[016789]-?\d{3,4}-?\d{4}/gu, "[REDACTED_PHONE]")
    .replace(/(?:\/private)?\/var\/folders\/[^\s]+|\/tmp\/[^\s]+/gu, "[REDACTED_TEMP_PATH]")
}

function findSensitiveAssignment(value) {
  outputAssignmentPattern.lastIndex = 0
  let match = outputAssignmentPattern.exec(value)
  while (match) {
    if (isSensitiveDiagnosticKey(match[2])) {
      return { start: match.index, valueStart: match.index + match[1].length }
    }
    match = outputAssignmentPattern.exec(value)
  }
  return null
}

function findAssignmentValueEnd(value, valueStart) {
  const first = value[valueStart]
  if (!first) return null
  if (first === '"' || first === "'") {
    let escaped = false
    for (let index = valueStart + 1; index < value.length; index += 1) {
      const character = value[index]
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === first) return index + 1
    }
    return null
  }
  const terminator = value.slice(valueStart).search(/[\s,;}\]]/u)
  return terminator < 0 ? null : valueStart + terminator
}

function isSensitiveDiagnosticKey(rawKey) {
  const normalized = rawKey
    .replace(/^['"]|['"]$/gu, "")
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/[-.\s]+/gu, "_")
    .toLowerCase()
  const parts = normalized.split("_").filter(Boolean)
  if (["authorization", "cookie", "set_cookie", "jwt"].includes(normalized)) return true
  if (
    ["anon_key", "api_key", "id_token", "refresh_token", "service_role_key"].includes(normalized)
  ) {
    return true
  }
  if (parts.some((part) => ["cookie", "jwt", "password", "secret", "token"].includes(part))) {
    return true
  }
  if (!normalized.endsWith("_key")) return false
  return parts.some((part) =>
    ["anon", "api", "auth", "payment", "provider", "publishable", "service"].includes(part),
  )
}

function truncateUtf8(value, limit) {
  const buffer = Buffer.from(value)
  return buffer.length <= limit ? value : buffer.subarray(buffer.length - limit).toString("utf8")
}
