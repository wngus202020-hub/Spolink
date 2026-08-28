import { ensureAuthGatewayReady } from "../../auth-rls/runtime.mjs"
import { createDatabaseBarrier } from "../../database-barrier.mjs"
import { createLearnerCookieJar } from "../../ssr-cookie-jar.mjs"
import { createLessonImageDatabase } from "../database.mjs"
import {
  createLessonImagePersonaClients,
  provisionLessonImageFixtures,
  signInLessonImagePersonas,
  signOutLessonImagePersonas,
} from "../provision.mjs"
import { startIsolatedLessonImageNext, startLessonImageFaultProxy } from "../runtime.mjs"
import { cleanupIsAllZero, safeErrorCode } from "./evidence.mjs"

export function createLessonImageLiveLifecycle(blockers, observations) {
  let barrier = null
  let clients = null
  let database = null
  let next = null
  let provision = null
  let proxy = null

  return {
    async cleanup() {
      let cleanup = null
      const cleanupErrors = []
      await collectError(cleanupErrors, async () => {
        if (clients) await signOutLessonImagePersonas(clients)
      })
      await collectError(cleanupErrors, async () => {
        if (next) await next.stop()
        next = null
      })
      await collectError(cleanupErrors, async () => {
        if (proxy) await proxy.stop()
        proxy = null
      })
      await collectError(cleanupErrors, async () => {
        if (database && provision) await database.cleanup(provision)
      })
      await collectError(cleanupErrors, async () => {
        if (provision) await provision.cleanup()
      })
      await collectError(cleanupErrors, async () => {
        const databaseCounts =
          database && provision ? await database.assertNamespaceZero(provision) : {}
        const fixtureCounts = provision ? await provision.assertZero() : {}
        cleanup = { ...databaseCounts, ...fixtureCounts }
        if (!cleanupIsAllZero(cleanup)) throw new Error("Lesson-image cleanup was not all zero")
      })
      if (cleanupErrors.length > 0) {
        blockers.push({
          actual: "cleanup_error",
          code: safeErrorCode(cleanupErrors[0]),
          errorCount: cleanupErrors.length,
          criterion: "namespace_zero",
          expected: "storage_db_auth_zero",
        })
      }
      const teardownErrors = []
      await collectError(teardownErrors, async () => {
        if (database) await database.close()
      })
      await collectError(teardownErrors, async () => {
        if (barrier) await barrier.close()
      })
      await collectError(teardownErrors, async () => {
        if (provision) await provision.close()
      })
      if (teardownErrors.length > 0) {
        blockers.push({
          actual: "teardown_error",
          code: safeErrorCode(teardownErrors[0]),
          errorCount: teardownErrors.length,
          criterion: "runtime_teardown",
          expected: "next_proxy_temp_zero",
        })
      }
      return cleanup
    },
    get proxyObservations() {
      return proxy?.observations ?? []
    },
    async start() {
      await ensureAuthGatewayReady()
      const runId = process.env.SPOLINK_TASK9_RUN_ID ?? "focused"
      provision = await provisionLessonImageFixtures({ runId })
      database = createLessonImageDatabase(provision.status)
      barrier = createDatabaseBarrier(
        provision.status.dbUrl,
        `spolink-task9-${provision.namespace.digest.slice(0, 12)}`,
      )
      proxy = await startLessonImageFaultProxy(provision.status.apiUrl)
      const proxiedStatus = { ...provision.status, apiUrl: proxy.baseUrl }
      next = await startIsolatedLessonImageNext({
        portBase: provision.namespace.portBase,
        repoRoot: process.cwd(),
        runId,
        status: proxiedStatus,
      })
      clients = createLessonImagePersonaClients(proxiedStatus, provision.users)
      await signInLessonImagePersonas(clients, provision.users, provision.runPassword)
      const jars = await createPersonaJars(proxiedStatus, provision.users, provision.runPassword)
      const foreignCoachProfileId = await database.createForeignApprovedCoach(provision)
      return {
        barrier,
        blockers,
        clients,
        database,
        foreignCoachProfileId,
        jars,
        next,
        observations,
        provision,
        proxiedStatus,
        proxy,
      }
    },
  }
}

async function collectError(errors, operation) {
  try {
    await operation()
  } catch (error) {
    errors.push(error)
  }
}

async function createPersonaJars(status, users, password) {
  const entries = await Promise.all(
    users.map(async (user) => [
      user.key,
      await createLearnerCookieJar({ email: user.email, password, status }),
    ]),
  )
  return Object.fromEntries(entries)
}
