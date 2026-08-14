import { makeProfileRow, TEST_USER_ID } from "./fixtures.mjs"

export function makeRouteHarness(options = {}) {
  const calls = []
  const user = Object.hasOwn(options, "user") ? options.user : { id: TEST_USER_ID }
  const rows = [...(options.rows ?? [])]
  const harness = {
    calls,
    lastUpdatedUserId: null,
    mutationCount: 0,
    rows,
  }

  harness.dependencies = {
    createSupabaseClient: async (responseHeaders) => {
      calls.push("client")
      if (options.setCookie) responseHeaders.append("Set-Cookie", options.setCookie)
      return {}
    },
    createWorkflowDependencies: () => {
      calls.push("workflow-deps")
      return makeWorkflowDependencies({ calls, harness, options, rows, user })
    },
    isSupabaseConfigured: () => {
      calls.push("config")
      return options.configured ?? true
    },
  }

  return harness
}

function makeWorkflowDependencies({ calls, harness, options, rows, user }) {
  return {
    createProfile: async (input) => {
      calls.push("insert-profile")
      if (rows.some((row) => row.id === input.id)) {
        return { errorCode: "23505", profile: null }
      }
      const profile = makeProfileRow({
        defaultRegion: input.defaultRegion,
        displayName: input.displayName,
        id: input.id,
        locationAgreedAt: input.locationAgreedAt,
        marketingAgreedAt: input.marketingAgreedAt,
        phone: input.phone,
        realName: input.realName,
      })
      rows.push(profile)
      harness.mutationCount += 1
      return { errorCode: null, profile }
    },
    getCoachProfile: async () => {
      calls.push("select-coach-profile")
      return {
        coachProfile: options.coachProfile ?? null,
        errorCode: options.coachErrorCode ?? null,
      }
    },
    getCurrentProfile: async (userId) => {
      calls.push("select-profile")
      return {
        errorCode: options.profileErrorCode ?? null,
        profile: rows.find((row) => row.id === userId) ?? null,
      }
    },
    getVerifiedAuthUser: async () => {
      calls.push("claims")
      return user
    },
    now: () => "2026-07-19T00:00:00.000Z",
    updateProfile: async (targetUserId, patch) =>
      updateProfile({ calls, harness, patch, rows, targetUserId }),
  }
}

function updateProfile({ calls, harness, patch, rows, targetUserId }) {
  calls.push("update-profile")
  harness.lastUpdatedUserId = targetUserId
  const current = rows.find((row) => row.id === targetUserId)
  if (!current) return { errorCode: "PGRST116", profile: null }
  const updated = {
    ...current,
    avatar_path: Object.hasOwn(patch, "avatar_path") ? patch.avatar_path : current.avatar_path,
    default_region: Object.hasOwn(patch, "default_region")
      ? patch.default_region
      : current.default_region,
    display_name: patch.display_name ?? current.display_name,
    location_agreed_at: Object.hasOwn(patch, "location_agreed_at")
      ? patch.location_agreed_at
      : current.location_agreed_at,
    marketing_agreed_at: Object.hasOwn(patch, "marketing_agreed_at")
      ? patch.marketing_agreed_at
      : current.marketing_agreed_at,
    phone: Object.hasOwn(patch, "phone") ? patch.phone : current.phone,
    real_name: Object.hasOwn(patch, "real_name") ? patch.real_name : current.real_name,
  }
  const index = rows.findIndex((row) => row.id === targetUserId)
  rows.splice(index, 1, updated)
  harness.mutationCount += 1
  return { errorCode: null, profile: updated }
}
