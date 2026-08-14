export const learnerId = "00000000-0000-4000-8000-000000000001"
export const otherLearnerId = "00000000-0000-4000-8000-000000000002"
const lessonId = "00000000-0000-4000-8000-000000000101"
const coachProfileId = "00000000-0000-4000-8000-000000000201"
const scheduleId = "00000000-0000-4000-8000-000000000301"
export const reservationId = "00000000-0000-4000-8000-000000000401"
export const seededPaymentId = "00000000-0000-4000-8000-000000000501"
export const insertedPaymentId = "00000000-0000-4000-8000-000000000999"

export async function seedReadyReservation(db, options = {}) {
  const status = options.status ?? "pending_payment"
  const paymentExpiresAt = options.paymentExpiresAt ?? "now() + interval '10 minutes'"

  await seedProfile(db, learnerId, "learner")
  await db.exec(`
    insert into public.lessons (id, coach_profile_id, title)
    values ('${lessonId}', '${coachProfileId}', '입문 테니스 레슨');

    insert into public.reservations (
      id,
      lesson_id,
      lesson_schedule_id,
      learner_id,
      coach_profile_id,
      status,
      reserved_price_amount,
      payment_expires_at
    )
    values (
      '${reservationId}',
      '${lessonId}',
      '${scheduleId}',
      '${learnerId}',
      '${coachProfileId}',
      '${status}',
      50000,
      ${paymentExpiresAt}
    );
  `)
}

export async function seedProfile(db, id, role) {
  await db.query(
    `
      insert into public.profiles (id, role, status, display_name)
      values ($1, $2, 'active', $3)
      on conflict (id) do update
      set role = excluded.role
    `,
    [id, role, `Profile ${id}`],
  )
}

export async function seedPayment(db, status) {
  await db.query(
    `
      insert into public.payments (
        id,
        reservation_id,
        payer_id,
        status,
        provider,
        provider_order_id,
        amount
      )
      values ($1, $2, $3, $4, 'toss', $5, 50000)
    `,
    [seededPaymentId, reservationId, learnerId, status, `spolink_${reservationId}`],
  )
}
