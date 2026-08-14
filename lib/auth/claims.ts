export type VerifiedAuthClaims = Readonly<{
  sessionId: string
  sub: string
}>

export function readVerifiedClaims(value: unknown): VerifiedAuthClaims | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null

  const sub = readStringProperty(value, "sub")
  const sessionId = readStringProperty(value, "session_id")
  if (!sub || !sessionId) return null

  return { sessionId, sub }
}

function readStringProperty(value: object, key: string): string | null {
  for (const [propertyKey, propertyValue] of Object.entries(value)) {
    if (propertyKey === key && typeof propertyValue === "string" && propertyValue.length > 0) {
      return propertyValue
    }
  }
  return null
}
