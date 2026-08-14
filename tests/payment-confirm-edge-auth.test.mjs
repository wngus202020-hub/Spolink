import assert from "node:assert/strict"
import test from "node:test"

import { isAuthorizedEdgeRequestHeader } from "../lib/payments/edge-auth.ts"

test("edge auth accepts only an exact bearer secret", () => {
  const expectedSecret = "0123456789abcdef"

  assert.equal(isAuthorizedEdgeRequestHeader(`Bearer ${expectedSecret}`, expectedSecret), true)
  assert.equal(isAuthorizedEdgeRequestHeader(null, expectedSecret), false)
  assert.equal(isAuthorizedEdgeRequestHeader("Bearer wrong", expectedSecret), false)
  assert.equal(isAuthorizedEdgeRequestHeader(expectedSecret, expectedSecret), false)
})
