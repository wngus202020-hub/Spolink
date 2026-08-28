export async function provisionDatabaseFixture(sql, fixture) {
  const [sport] = await sql`select id from public.sports where is_active order by id limit 1`
  await sql`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000', ${fixture.userId}, 'authenticated',
      'authenticated', ${`image-idempotency-${fixture.userId}@example.test`}, '', now(),
      ${sql.json({ provider: "email", providers: ["email"] })}, '{}'
    )
  `
  await sql`
    insert into public.profiles (id, display_name, role, status)
    values (${fixture.userId}, 'Image idempotency owner', 'coach', 'coach_approved')
  `
  await sql`
    insert into public.coach_profiles (id, user_id, status, primary_sport_id, service_region)
    values (${fixture.coachProfileId}, ${fixture.userId}, 'approved', ${sport.id}, '서울 강남구')
  `
  await sql`
    insert into public.lessons (
      id, coach_profile_id, sport_id, title, description, region,
      duration_minutes, price_amount, capacity, status
    ) values (
      ${fixture.lessonId}, ${fixture.coachProfileId}, ${sport.id}, 'Image idempotency lesson',
      'Concurrent registration fixture', '서울 강남구', 60, 10000, 5, 'draft'
    )
  `
  await sql`
    insert into public.lesson_image_upload_intents (
      id, lesson_id, coach_profile_id, user_id, object_name, mime_type, size_bytes
    ) values (
      ${fixture.intentId}, ${fixture.lessonId}, ${fixture.coachProfileId}, ${fixture.userId},
      ${fixture.objectName}, 'image/png', 8
    )
  `
  await sql`
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values (
      'lesson-images', ${fixture.objectName}, ${fixture.userId},
      ${sql.json({ mimetype: "image/png", size: 8 })}
    )
  `
  return sport
}

export async function removeDatabaseFixture(sql, service, fixture) {
  const { error } = await service.storage.from("lesson-images").remove([fixture.objectName])
  if (error) throw error
  await sql`delete from public.lessons where id = ${fixture.lessonId}`
  await sql`delete from public.coach_profiles where id = ${fixture.coachProfileId}`
  await sql`delete from public.profiles where id = ${fixture.userId}`
  await sql`delete from auth.users where id = ${fixture.userId}`
}

export function registerInTransaction(sql, input) {
  return sql.begin(async (transaction) => {
    await transaction`set local role service_role`
    return transaction`
      select * from public.register_validated_lesson_image(
        ${input.userId}, ${input.intentId}, ${input.objectName}
      )
    `
  })
}

export function beginDeleteInTransaction(sql, input) {
  return asOwnerTransaction(
    sql,
    input.userId,
    (transaction) => transaction`
    select * from public.begin_delete_lesson_image(
      ${input.lessonId}, ${input.imageId}, ${input.expectedImageIds}
    )
  `,
  )
}

export function finalizeDeleteInTransaction(sql, input) {
  return asOwnerTransaction(
    sql,
    input.userId,
    (transaction) => transaction`
    select * from public.finalize_delete_lesson_image(${input.lessonId}, ${input.imageId})
  `,
  )
}

function asOwnerTransaction(sql, userId, operation) {
  return sql.begin(async (transaction) => {
    await transaction`
      select set_config(
        'request.jwt.claims',
        jsonb_build_object('sub', ${userId}::uuid, 'role', 'authenticated')::text,
        true
      )
    `
    await transaction`select set_config('request.jwt.claim.sub', ${userId}::text, true)`
    await transaction`select set_config('request.jwt.claim.role', 'authenticated', true)`
    await transaction`set local role authenticated`
    return operation(transaction)
  })
}
