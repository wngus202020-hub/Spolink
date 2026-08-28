import postgres from "postgres"

export function createLessonImageDatabase(status) {
  const sql = postgres(status.dbUrl, { idle_timeout: 1, max: 3 })
  const lessonIds = new Set()
  const objectNames = new Set()

  return {
    lessonIds,
    objectNames,
    sql,
    trackObject(objectName) {
      objectNames.add(objectName)
    },
    async createForeignApprovedCoach(provision) {
      const id = provision.namespace.foreignCoachProfileId
      const service = provision.clients.serviceClient
      const { error: coachError } = await service.from("coach_profiles").insert({
        id,
        primary_sport_id: provision.rows.coachProfiles[0].primary_sport_id,
        service_region: "서울 성동구",
        status: "approved",
        user_id: provision.authIds.otherLearner,
      })
      if (coachError) throw coachError
      await sql`
        update public.profiles set status = 'coach_approved'
        where id = ${provision.authIds.otherLearner}
      `
      return id
    },
    async createLesson(provision, { coachProfileId, state = "draft", withSchedule = false } = {}) {
      const id = provision.namespace.nextId("lesson")
      lessonIds.add(id)
      const coachId = coachProfileId ?? provision.rows.coachProfiles[0].id
      await sql`
        insert into public.lessons (
          id, coach_profile_id, sport_id, status, title, description, summary,
          region, duration_minutes, price_amount, capacity
        ) values (
          ${id}, ${coachId}, ${provision.rows.coachProfiles[0].primary_sport_id}, ${state},
          ${`Task9 lesson ${lessonIds.size}`}, 'Task9 live lesson image description',
          'Task9 live image summary', '서울 성동구', 60, 10000, 5
        )
      `
      if (withSchedule) {
        const startsAt = new Date(Date.now() + 48 * 60 * 60 * 1000)
        const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000)
        await sql`
          insert into public.lesson_schedules (
            id, lesson_id, starts_at, ends_at, capacity, reserved_count, is_open
          ) values (
            ${provision.namespace.nextId("schedule")}, ${id}, ${startsAt.toISOString()}, ${endsAt.toISOString()}, 5, 0, true
          )
        `
      }
      return id
    },
    async readLesson(lessonId) {
      const [row] = await sql`
        select
          id::text,
          status::text,
          to_char(
            updated_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ) as updated_at
        from public.lessons where id = ${lessonId}
      `
      return row ?? null
    },
    async readImages(lessonId) {
      return sql`
        select id::text, file_path, sort_order::int, lifecycle_state
        from public.lesson_images where lesson_id = ${lessonId}
        order by sort_order, id
      `
    },
    async readIntents(lessonId) {
      return sql`
        select id::text, object_name, status, expires_at::text
        from public.lesson_image_upload_intents where lesson_id = ${lessonId}
        order by created_at, id
      `
    },
    async expireIntent(intentId) {
      await sql`
        update public.lesson_image_upload_intents
        set expires_at = statement_timestamp() - interval '1 second'
        where id = ${intentId}
      `
    },
    holdLesson: (lessonId) => holdLesson(sql, lessonId),
    async setImageLifecycle(imageId, lifecycleState) {
      await sql`
        update public.lesson_images
        set lifecycle_state = ${lifecycleState}
        where id = ${imageId}
      `
    },
    async objectRowExists(objectName) {
      const [row] = await sql`
        select exists(
          select 1 from storage.objects
          where bucket_id = 'lesson-images' and name = ${objectName}
        ) as exists
      `
      return row?.exists === true
    },
    async cleanup(provision) {
      for (const lessonId of lessonIds) {
        const { data } = await provision.clients.serviceClient.storage
          .from("lesson-images")
          .list(lessonId, { limit: 100 })
        for (const object of data ?? []) objectNames.add(`${lessonId}/${object.name}`)
      }
      if (objectNames.size > 0) {
        const { error } = await provision.clients.serviceClient.storage
          .from("lesson-images")
          .remove([...objectNames])
        if (error) throw error
      }
      if (lessonIds.size > 0) {
        const ids = [...lessonIds]
        await sql`delete from public.audit_logs where target_id in ${sql(ids)}`
        await sql`delete from public.lessons where id in ${sql(ids)}`
      }
    },
    async assertNamespaceZero(provision) {
      const ids = [...lessonIds]
      if (ids.length > 0) {
        const [row] = await sql`
          select
            (select count(*)::int from public.lessons where id in ${sql(ids)}) as lessons,
            (select count(*)::int from public.lesson_images where lesson_id in ${sql(ids)}) as images,
            (select count(*)::int from public.lesson_image_upload_intents where lesson_id in ${sql(ids)}) as intents
        `
        if (row.lessons !== 0 || row.images !== 0 || row.intents !== 0) {
          throw new Error("Lesson-image DB namespace cleanup failed")
        }
      }
      for (const lessonId of lessonIds) {
        const { data, error } = await provision.clients.serviceClient.storage
          .from("lesson-images")
          .list(lessonId, { limit: 100 })
        if (error || (data?.length ?? 0) !== 0) {
          throw new Error("Lesson-image Storage namespace cleanup failed")
        }
      }
      return { images: 0, intents: 0, lessons: 0, objects: 0 }
    },
    async close() {
      await sql.end({ timeout: 1 })
    },
  }
}

async function holdLesson(sql, lessonId) {
  let release
  let abort
  let lockerPid
  const locked = deferred()
  const released = new Promise((resolve, reject) => {
    release = resolve
    abort = reject
  })
  const done = sql
    .begin(async (tx) => {
      const [pidRow] = await tx`select pg_backend_pid()::int as pid`
      lockerPid = pidRow.pid
      await tx`select id from public.lessons where id = ${lessonId} for update`
      locked.resolve()
      await released
    })
    .catch((error) => {
      if (error.message !== "task9 lesson barrier rollback") throw error
    })
  await locked.promise
  return {
    abort: () => abort(new Error("task9 lesson barrier rollback")),
    done,
    lockerPid,
    release,
  }
}

function deferred() {
  const result = {}
  result.promise = new Promise((resolve, reject) => {
    result.resolve = resolve
    result.reject = reject
  })
  return result
}
