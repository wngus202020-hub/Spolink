export const adminDashboardTargetCounts = {
  coachApplications: 1,
  disputedReservations: 4,
  heldSettlements: 5,
  lessonReviews: 2,
  openReports: 3,
}

const countKeys = Object.keys(adminDashboardTargetCounts)

export class AdminDashboardFixtureBaselineError extends Error {
  constructor() {
    super("Admin dashboard fixture requires a zero-count baseline")
    this.code = "ADMIN_DASHBOARD_FIXTURE_BASELINE_NOT_FRESH"
    this.name = "AdminDashboardFixtureBaselineError"
  }
}

export function parseAdminDashboardCounts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Admin dashboard counts must be an object")
  }
  const keys = Object.keys(value).sort()
  if (JSON.stringify(keys) !== JSON.stringify([...countKeys].sort())) {
    throw new TypeError("Admin dashboard counts have an invalid shape")
  }
  for (const key of countKeys) {
    if (!Number.isInteger(value[key]) || value[key] < 0) {
      throw new TypeError("Admin dashboard counts must be nonnegative integers")
    }
  }
  return value
}

export function assertFreshAdminDashboardBaseline(value) {
  const counts = parseAdminDashboardCounts(value)
  if (Object.values(counts).some((count) => count !== 0)) {
    throw new AdminDashboardFixtureBaselineError()
  }
  return counts
}

export async function createOwnedAdminDashboardFixture(adapter) {
  assertFreshAdminDashboardBaseline(await adapter.readCounts())
  try {
    await adapter.insert()
  } catch (error) {
    await adapter.remove()
    throw error
  }
  let cleanupPromise = null
  return {
    cleanup: () => {
      cleanupPromise ??= adapter.remove()
      return cleanupPromise
    },
    counts: adminDashboardTargetCounts,
  }
}
