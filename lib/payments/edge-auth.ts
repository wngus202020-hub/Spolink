import { timingSafeEqual } from "node:crypto"

export function isAuthorizedEdgeRequestHeader(
  authorization: string | null,
  expectedSecret: string,
) {
  return authorization !== null && timingSafeEqualString(authorization, `Bearer ${expectedSecret}`)
}

function timingSafeEqualString(value: string, expectedValue: string) {
  const valueBuffer = Buffer.from(value)
  const expectedValueBuffer = Buffer.from(expectedValue)

  return (
    valueBuffer.length === expectedValueBuffer.length &&
    timingSafeEqual(valueBuffer, expectedValueBuffer)
  )
}
