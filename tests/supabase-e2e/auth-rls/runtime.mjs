import { readGuardedLocalStatus } from "../local-status.mjs"
import { provisionFixtures } from "../provision.mjs"

export async function ensureAuthGatewayReady(options = {}) {
  const retryCount = options.retryCount ?? 20
  const waitMs = options.waitMs ?? 500
  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    if (await canReachAuthGateway(options)) return
    await delay(waitMs)
  }
  throw new Error(
    "Supabase Auth gateway is unavailable; main executor must start or reset Supabase before Todo 7 tests",
  )
}

export async function provisionWithAuthReadiness() {
  let lastError
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      return await provisionFixtures()
    } catch (error) {
      lastError = error
      if (!isAuthReadinessError(error)) throw error
      await delay(attempt * 500)
    }
  }
  throw lastError
}

async function canReachAuthGateway(options = {}) {
  const readLocalStatus = options.readLocalStatus ?? readGuardedLocalStatus
  const fetchHealth = options.fetch ?? fetch
  const localStatus = await readLocalStatus()
  try {
    const response = await fetchHealth(`${localStatus.apiUrl}/auth/v1/health`)
    return response.status < 500
  } catch (error) {
    if (error instanceof Error) return false
    throw error
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isAuthReadinessError(error) {
  return error?.name === "AuthRetryableFetchError" || error?.status === 502
}
