const canonicalMobilePhonePattern = /^01[016789]-[0-9]{3,4}-[0-9]{4}$/
const compactMobilePhonePattern = /^01[016789][0-9]{7,8}$/

export function normalizeProfilePhone(value: string): string | null {
  const trimmed = value.trim()
  if (canonicalMobilePhonePattern.test(trimmed)) return trimmed
  if (!compactMobilePhonePattern.test(trimmed)) return null

  const middleEnd = trimmed.length - 4
  return `${trimmed.slice(0, 3)}-${trimmed.slice(3, middleEnd)}-${trimmed.slice(middleEnd)}`
}
