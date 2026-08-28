import { cleanupOwnedServer, withTimeout } from "../public-gallery-browser-qa-runtime.mjs"

export async function cleanupPublicGallery(context, signal) {
  context.progress("cleanup-started")
  let timedOut = false
  signal.addEventListener(
    "abort",
    () => {
      timedOut = true
      context.progress("cleanup-timeout-reached", { continuing: true })
    },
    { once: true },
  )
  const injectedDelay = Number(process.env.PUBLIC_GALLERY_INJECT_CLEANUP_DELAY_MS ?? 0)
  if (Number.isInteger(injectedDelay) && injectedDelay > 0 && injectedDelay <= 10_000) {
    await new Promise((resolve) => setTimeout(resolve, injectedDelay))
  }
  const errors = []
  const attempt = async (label, action, timeoutMs = 3_000) => {
    try {
      return await withTimeout(`cleanup ${label}`, timeoutMs, () => action())
    } catch (error) {
      errors.push({ label, message: safeError(error) })
      return undefined
    }
  }
  const [, ownedServerReceipt] = await Promise.all([
    context.resources.browser
      ? attempt("browser", () => context.resources.browser.close())
      : undefined,
    attempt(
      "owned_server",
      () => cleanupOwnedServer(context.resources.ownedServer, context.progress),
      9_000,
    ),
  ])
  const server = ownedServerReceipt ?? {
    portFree: false,
    processStopped: false,
    tempRemoved: false,
  }
  const lessonIds = Object.values(context.fixture.lessonIds)
  await attempt(
    "image_rows",
    () =>
      context.sql`delete from public.lesson_images where lesson_id in ${context.sql(lessonIds)}`,
  )
  if (context.fixture.storagePaths.length > 0) {
    await attempt("storage_objects", async () => {
      const removed = await context.service.storage
        .from("lesson-images")
        .remove(context.fixture.storagePaths)
      if (removed.error) throw removed.error
    })
  }
  await attempt(
    "schedule_rows",
    () =>
      context.sql`delete from public.lesson_schedules where lesson_id in ${context.sql(lessonIds)}`,
  )
  await attempt(
    "lesson_rows",
    () => context.sql`delete from public.lessons where id in ${context.sql(lessonIds)}`,
  )
  await attempt(
    "coach_rows",
    () =>
      context.sql`delete from public.coach_profiles where id = ${context.fixture.coachProfileId}`,
  )
  if (context.fixture.coachId) {
    await attempt(
      "profile_rows",
      () => context.sql`delete from public.profiles where id = ${context.fixture.coachId}`,
    )
    await attempt("auth_user", async () => {
      const deleted = await context.service.auth.admin.deleteUser(context.fixture.coachId)
      if (deleted.error && deleted.error.status !== 404) throw deleted.error
    })
  }
  const counts = await attempt("zero_counts", () => readZeroCounts(context, lessonIds))
  await attempt("sql_close", () => context.sql.end({ timeout: 5 }))
  const allZero =
    errors.length === 0 &&
    counts !== undefined &&
    Object.values(counts).every((count) => count === 0) &&
    server.portFree
  const receipt = { allZero, counts: counts ?? null, errors, server, timedOut }
  context.progress("cleanup-verified", { allZero })
  return receipt
}

async function readZeroCounts(context, lessonIds) {
  const [rows] = await context.sql`
    select
      (select count(*)::integer from public.lesson_images where lesson_id in ${context.sql(lessonIds)}) image_rows,
      (select count(*)::integer from public.lesson_schedules where lesson_id in ${context.sql(lessonIds)}) schedule_rows,
      (select count(*)::integer from public.lessons where id in ${context.sql(lessonIds)}) lesson_rows,
      (select count(*)::integer from public.coach_profiles where id = ${context.fixture.coachProfileId}) coach_rows,
      (select count(*)::integer from public.profiles where id = ${context.fixture.coachId}) profile_rows,
      (select count(*)::integer from auth.users where id = ${context.fixture.coachId}) auth_rows
  `
  let storageObjects = 0
  for (const lessonId of lessonIds) {
    const listed = await context.service.storage.from("lesson-images").list(lessonId, { limit: 10 })
    if (listed.error) throw listed.error
    storageObjects += listed.data.length
  }
  const users = await context.service.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (users.error) throw users.error
  return {
    ...rows,
    service_auth_users: users.data.users.filter((user) => user.id === context.fixture.coachId)
      .length,
    storage_objects: storageObjects,
  }
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error)
}
