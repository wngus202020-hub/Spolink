import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

export const RECOVERY_INTENT_COOKIE = "spolink_recovery_intent"
export const RECOVERY_COOKIE = "spolink_recovery"
export const AUTH_FLOW_TOKEN_LIFETIME_SECONDS = 600

export type RecoveryIntentPayload = Readonly<{
  exp: number
  iat: number
  jti: string
  purpose: "password_recovery_intent"
  v: 1
}>

export type RecoveryPayload = Readonly<{
  exp: number
  iat: number
  jti: string
  purpose: "password_recovery"
  sessionId: string
  sub: string
  v: 1
}>

export type VerifiedToken<T> = Readonly<
  | {
      payload: T
      status: "success"
    }
  | {
      status: "failure"
    }
>

export function createRecoveryIntentToken(secret: Buffer, now = currentUnixSeconds()) {
  const payload = orderedIntentPayload(makeJti(), now)
  return { jti: payload.jti, token: signPayload(payload, secret) }
}

export function createRecoveryToken(
  input: Readonly<{ secret: Buffer; sessionId: string; sub: string; now?: number }>,
) {
  const payload = orderedRecoveryPayload(
    makeJti(),
    input.sub,
    input.sessionId,
    input.now ?? currentUnixSeconds(),
  )
  return { jti: payload.jti, payload, token: signPayload(payload, input.secret) }
}

export function verifyRecoveryIntentToken(
  token: string,
  secret: Buffer,
  now = currentUnixSeconds(),
): VerifiedToken<RecoveryIntentPayload> {
  const result = verifyToken(token, secret, ["v", "purpose", "jti", "iat", "exp"], now)
  if (result.status === "failure") return result
  const payload = result.payload
  const v = readNumberProperty(payload, "v")
  const purpose = readStringProperty(payload, "purpose")
  const jti = readStringProperty(payload, "jti")
  const iat = readNumberProperty(payload, "iat")
  const exp = readNumberProperty(payload, "exp")
  if (
    v !== 1 ||
    purpose !== "password_recovery_intent" ||
    !jti ||
    iat === null ||
    exp === null ||
    !isValidLifetime(iat, exp, now)
  ) {
    return { status: "failure" }
  }
  return { payload: orderedIntentPayload(jti, iat), status: "success" }
}

export function verifyRecoveryToken(
  token: string,
  secret: Buffer,
  now = currentUnixSeconds(),
): VerifiedToken<RecoveryPayload> {
  const result = verifyToken(
    token,
    secret,
    ["v", "purpose", "jti", "sub", "sessionId", "iat", "exp"],
    now,
  )
  if (result.status === "failure") return result
  const payload = result.payload
  const v = readNumberProperty(payload, "v")
  const purpose = readStringProperty(payload, "purpose")
  const jti = readStringProperty(payload, "jti")
  const sub = readStringProperty(payload, "sub")
  const sessionId = readStringProperty(payload, "sessionId")
  const iat = readNumberProperty(payload, "iat")
  const exp = readNumberProperty(payload, "exp")
  if (
    v !== 1 ||
    purpose !== "password_recovery" ||
    !jti ||
    !sub ||
    !sessionId ||
    iat === null ||
    exp === null ||
    !isValidLifetime(iat, exp, now)
  ) {
    return { status: "failure" }
  }
  return {
    payload: orderedRecoveryPayload(jti, sub, sessionId, iat),
    status: "success",
  }
}

export function sha256HexUtf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function orderedIntentPayload(jti: string, iat: number): RecoveryIntentPayload {
  return {
    v: 1,
    purpose: "password_recovery_intent",
    jti,
    iat,
    exp: iat + AUTH_FLOW_TOKEN_LIFETIME_SECONDS,
  }
}

function orderedRecoveryPayload(
  jti: string,
  sub: string,
  sessionId: string,
  iat: number,
): RecoveryPayload {
  return {
    v: 1,
    purpose: "password_recovery",
    jti,
    sub,
    sessionId,
    iat,
    exp: iat + AUTH_FLOW_TOKEN_LIFETIME_SECONDS,
  }
}

function signPayload(payload: RecoveryIntentPayload | RecoveryPayload, secret: Buffer): string {
  const payloadSegment = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signatureSegment = createHmac("sha256", secret).update(payloadSegment).digest("base64url")
  return `${payloadSegment}.${signatureSegment}`
}

function verifyToken(
  token: string,
  secret: Buffer,
  expectedKeys: readonly string[],
  now: number,
): VerifiedToken<Record<string, unknown>> {
  const [payloadSegment, signatureSegment, extraSegment] = token.split(".")
  if (!payloadSegment || !signatureSegment || extraSegment !== undefined)
    return { status: "failure" }

  const expectedSignature = createHmac("sha256", secret).update(payloadSegment).digest()
  const signature = Buffer.from(signatureSegment, "base64url")
  if (
    signature.length !== expectedSignature.length ||
    !timingSafeEqual(signature, expectedSignature)
  ) {
    return { status: "failure" }
  }

  const payloadBytes = Buffer.from(payloadSegment, "base64url")
  const parsed = parsePayload(payloadBytes)
  if (!parsed || !hasExactKeys(parsed, expectedKeys)) return { status: "failure" }

  const canonical = Buffer.from(JSON.stringify(parsed))
  if (!payloadBytes.equals(canonical)) return { status: "failure" }
  const iat = readNumberProperty(parsed, "iat")
  const exp = readNumberProperty(parsed, "exp")
  if (iat === null || exp === null) return { status: "failure" }
  if (!Number.isInteger(iat) || !Number.isInteger(exp) || iat > now) {
    return { status: "failure" }
  }

  return { payload: parsed, status: "success" }
}

function parsePayload(payloadBytes: Buffer): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(payloadBytes.toString("utf8"))
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null
    return Object.fromEntries(Object.entries(value))
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(value)
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  )
}

function readStringProperty(value: Record<string, unknown>, key: string): string | null {
  const property = value[key]
  return typeof property === "string" && property.length > 0 ? property : null
}

function readNumberProperty(value: Record<string, unknown>, key: string): number | null {
  const property = value[key]
  return typeof property === "number" ? property : null
}

function isValidLifetime(iat: number, exp: number, now: number): boolean {
  return exp - iat === AUTH_FLOW_TOKEN_LIFETIME_SECONDS && now <= exp
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function makeJti(): string {
  return randomBytes(32).toString("base64url")
}
