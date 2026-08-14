import "server-only"

export type AuthFlowSecretStatus = Readonly<
  | {
      configured: true
      secret: Buffer
    }
  | {
      configured: false
      reason: "missing" | "malformed" | "too_short"
    }
>

export class AuthFlowConfigError extends Error {
  readonly reason: "missing" | "malformed" | "too_short"

  constructor(reason: "missing" | "malformed" | "too_short") {
    super("Authentication flow is not configured.")
    this.name = "AuthFlowConfigError"
    this.reason = reason
  }
}

export function readAuthFlowSecret(): Buffer {
  const status = getAuthFlowSecretStatus()

  if (!status.configured) {
    throw new AuthFlowConfigError(status.reason)
  }

  return status.secret
}

export function getAuthFlowSecretStatus(
  value: string | undefined = process.env["SPOLINK_AUTH_FLOW_SECRET"],
): AuthFlowSecretStatus {
  if (typeof value !== "string" || value.length === 0) {
    return { configured: false, reason: "missing" }
  }

  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return { configured: false, reason: "malformed" }
  }

  const padding = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4))
  const decoded = Buffer.from(`${value.replace(/-/g, "+").replace(/_/g, "/")}${padding}`, "base64")

  if (decoded.length < 32) {
    return { configured: false, reason: "too_short" }
  }

  return { configured: true, secret: decoded }
}
