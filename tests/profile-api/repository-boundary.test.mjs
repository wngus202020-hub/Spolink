import assert from "node:assert/strict"
import test from "node:test"

import { TEST_USER_ID } from "./fixtures.mjs"

test("profile repository authorizes from verified getClaims subject only", async () => {
  const { createProfileWorkflowDependencies } = await import(
    "../../lib/profile/supabase-repository.ts"
  )
  const supabase = {
    auth: {
      getClaims: async () => ({ data: { claims: { sub: TEST_USER_ID } }, error: null }),
      getUser: async () => {
        throw new Error("getUser must not authorize profile APIs")
      },
    },
    from: () => {
      throw new Error("profile table should not be read by identity probe")
    },
  }

  const deps = createProfileWorkflowDependencies(supabase)

  assert.deepEqual(await deps.getVerifiedAuthUser(), { id: TEST_USER_ID })

  const missingClaimsDeps = createProfileWorkflowDependencies({
    ...supabase,
    auth: { getClaims: async () => ({ data: { claims: {} }, error: null }) },
  })
  assert.equal(await missingClaimsDeps.getVerifiedAuthUser(), null)
})
