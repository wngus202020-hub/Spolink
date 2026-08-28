import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith("/dashboard-repository")) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const {
  CoachDashboardReadError,
  getKstDayWindow,
  readCoachDashboard,
  summarizeCoachReservations,
  summarizeCoachSchedules,
} = await import("../lib/coach/dashboard-read-model.ts")

const now = new Date("2026-08-29T03:00:00.000Z")

function schedule(id, startsAt, overrides = {}) {
  return Object.freeze({
    capacity: 4,
    ends_at: "2026-08-29T05:00:00.000Z",
    id,
    is_open: true,
    lesson_id: "lesson-owned",
    reserved_count: 1,
    starts_at: startsAt,
    ...overrides,
  })
}

test("KST day window uses exact half-open UTC boundaries", () => {
  assert.deepEqual(getKstDayWindow(now), {
    endExclusive: "2026-08-29T15:00:00.000Z",
    start: "2026-08-28T15:00:00.000Z",
  })
})

test("schedule summary includes boundary, closed, zero, and full owned schedules", () => {
  const rows = Object.freeze([
    schedule("start", "2026-08-28T15:00:00.000Z"),
    schedule("closed", "2026-08-28T16:00:00.000Z", { is_open: false }),
    schedule("zero", "2026-08-28T17:00:00.000Z", { reserved_count: 0 }),
    schedule("full", "2026-08-28T18:00:00.000Z", { capacity: 2, reserved_count: 2 }),
    schedule("next-midnight", "2026-08-29T15:00:00.000Z"),
    schedule("foreign", "2026-08-28T19:00:00.000Z", { lesson_id: "lesson-foreign" }),
  ])

  const result = summarizeCoachSchedules(rows, Object.freeze(["lesson-owned"]), now)

  assert.deepEqual(
    result.map((row) => row.id),
    ["start", "closed", "zero", "full"],
  )
})
test("schedule summary has a stable timestamp and id order and limits output to eight", () => {
  const rows = Object.freeze([
    schedule("id-09", "2026-08-29T01:00:00.000Z"),
    schedule("id-02", "2026-08-28T16:00:00.000Z"),
    schedule("id-01", "2026-08-28T16:00:00.000Z"),
    schedule("id-08", "2026-08-29T00:00:00.000Z"),
    schedule("id-07", "2026-08-28T23:00:00.000Z"),
    schedule("id-06", "2026-08-28T22:00:00.000Z"),
    schedule("id-05", "2026-08-28T21:00:00.000Z"),
    schedule("id-04", "2026-08-28T20:00:00.000Z"),
    schedule("id-03", "2026-08-28T19:00:00.000Z"),
  ])

  const result = summarizeCoachSchedules(rows, Object.freeze(["lesson-owned"]), now)

  assert.deepEqual(
    result.map((row) => row.id),
    ["id-01", "id-02", "id-03", "id-04", "id-05", "id-06", "id-07", "id-08"],
  )
})

test("reservation summary counts only owned pending and confirmed rows", () => {
  const rows = Object.freeze([
    Object.freeze({ coach_profile_id: "coach-owned", status: "pending_payment" }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "confirmed" }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "confirmed" }),
    Object.freeze({ coach_profile_id: "coach-foreign", status: "pending_payment" }),
    Object.freeze({ coach_profile_id: "coach-foreign", status: "confirmed" }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "cancelled_by_user" }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "cancelled_by_coach" }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "completed" }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "unsupported_internal_state" }),
  ])

  assert.deepEqual(summarizeCoachReservations(rows, "coach-owned"), {
    completionPending: 2,
    confirmed: 2,
    labels: {
      confirmed: "예약 확정",
      pending_payment: "결제 대기",
    },
    pendingPayment: 1,
  })
})

test("invalid Date and malformed schedule timestamps fail with the typed read error", () => {
  assert.throws(() => getKstDayWindow(new Date("invalid")), CoachDashboardReadError)
  assert.throws(
    () =>
      summarizeCoachSchedules(
        Object.freeze([schedule("invalid", "not-a-timestamp")]),
        Object.freeze(["lesson-owned"]),
        now,
      ),
    CoachDashboardReadError,
  )
})

test("manual data JSON matches the exact KST dashboard summary", () => {
  const schedules = Object.freeze([
    schedule("schedule-09-omitted", "2026-08-29T02:00:00.000Z"),
    schedule("schedule-08", "2026-08-29T01:00:00.000Z"),
    schedule("schedule-07", "2026-08-29T00:00:00.000Z"),
    schedule("schedule-06", "2026-08-28T23:00:00.000Z"),
    schedule("schedule-05", "2026-08-28T22:00:00.000Z"),
    schedule("schedule-04-full", "2026-08-28T21:00:00.000Z", {
      capacity: 2,
      reserved_count: 2,
    }),
    schedule("schedule-03-zero", "2026-08-28T20:00:00.000Z", { reserved_count: 0 }),
    schedule("schedule-02-closed", "2026-08-28T19:00:00.000Z", { is_open: false }),
    schedule("schedule-01-boundary", "2026-08-28T15:00:00.000Z"),
    schedule("schedule-next-midnight", "2026-08-29T15:00:00.000Z"),
    schedule("schedule-foreign", "2026-08-28T18:00:00.000Z", {
      lesson_id: "lesson-foreign",
    }),
  ])
  const reservations = Object.freeze([
    Object.freeze({ coach_profile_id: "coach-owned", status: "pending_payment" }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "confirmed" }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "confirmed" }),
    Object.freeze({ coach_profile_id: "coach-foreign", status: "pending_payment" }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "cancelled_by_user" }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "completed" }),
  ])
  const window = getKstDayWindow(now)
  const actual = {
    endExclusive: window.endExclusive,
    scheduleIds: summarizeCoachSchedules(schedules, Object.freeze(["lesson-owned"]), now).map(
      (row) => row.id,
    ),
    start: window.start,
    ...summarizeCoachReservations(reservations, "coach-owned"),
  }
  const expected = {
    completionPending: 2,
    confirmed: 2,
    endExclusive: "2026-08-29T15:00:00.000Z",
    labels: {
      confirmed: "예약 확정",
      pending_payment: "결제 대기",
    },
    pendingPayment: 1,
    scheduleIds: [
      "schedule-01-boundary",
      "schedule-02-closed",
      "schedule-03-zero",
      "schedule-04-full",
      "schedule-05",
      "schedule-06",
      "schedule-07",
      "schedule-08",
    ],
    start: "2026-08-28T15:00:00.000Z",
  }

  assert.deepEqual(actual, expected)
  console.log(`MANUAL_DATA_JSON ${JSON.stringify(actual)}`)
})

const dashboardRows = Object.freeze({
  lesson_schedules: Object.freeze([
    schedule("schedule-late", "2026-08-29T03:00:00.000Z", { lesson_id: "lesson-second" }),
    schedule("schedule-first", "2026-08-28T16:00:00.000Z"),
    schedule("schedule-foreign", "2026-08-28T15:30:00.000Z", {
      lesson_id: "lesson-foreign",
    }),
  ]),
  lessons: Object.freeze([
    Object.freeze({ coach_profile_id: "coach-owned", id: "lesson-owned", title: "테니스 입문" }),
    Object.freeze({ coach_profile_id: "coach-owned", id: "lesson-second", title: "주말 러닝" }),
    Object.freeze({ coach_profile_id: "coach-foreign", id: "lesson-foreign", title: "외부 레슨" }),
  ]),
  notifications: Object.freeze([
    notification("owned-unread-1", "2026-08-29T04:00:00.000Z"),
    notification("owned-unread-2", "2026-08-29T03:00:00.000Z"),
    notification("owned-unread-3", "2026-08-29T02:00:00.000Z"),
    notification("owned-unread-4", "2026-08-29T01:00:00.000Z"),
    notification("owned-read", "2026-08-29T05:00:00.000Z", {
      read_at: "2026-08-29T05:30:00.000Z",
    }),
    notification("foreign-unread", "2026-08-29T06:00:00.000Z", { user_id: "profile-foreign" }),
  ]),
  reservations: Object.freeze([
    Object.freeze({
      coach_profile_id: "coach-owned",
      learner_email: "learner@example.test",
      status: "pending_payment",
    }),
    Object.freeze({
      coach_profile_id: "coach-owned",
      learner_phone: "010-0000-0000",
      status: "confirmed",
    }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "cancelled_by_user" }),
    Object.freeze({ coach_profile_id: "coach-foreign", status: "confirmed" }),
  ]),
  reviews: Object.freeze([
    review("visible-1", "2026-08-29T04:00:00.000Z"),
    review("visible-2", "2026-08-29T03:00:00.000Z", { lesson_id: "lesson-second" }),
    review("visible-3", "2026-08-29T02:00:00.000Z"),
    review("visible-4", "2026-08-29T01:00:00.000Z"),
    review("hidden", "2026-08-29T05:00:00.000Z", { status: "hidden" }),
    review("deleted", "2026-08-29T06:00:00.000Z", { status: "deleted" }),
    review("foreign", "2026-08-29T07:00:00.000Z", { coach_profile_id: "coach-foreign" }),
  ]),
  settlements: Object.freeze([
    Object.freeze({
      coach_profile_id: "coach-owned",
      gross_amount: 15000,
      net_amount: 12000,
      status: "pending",
    }),
    Object.freeze({
      coach_profile_id: "coach-owned",
      gross_amount: 25000,
      net_amount: 21000,
      status: "pending",
    }),
    Object.freeze({ coach_profile_id: "coach-owned", net_amount: 8000, status: "hold" }),
    Object.freeze({ coach_profile_id: "coach-owned", net_amount: 7000, status: "approved" }),
    Object.freeze({ coach_profile_id: "coach-owned", net_amount: 6000, status: "paid" }),
    Object.freeze({ coach_profile_id: "coach-owned", net_amount: 5000, status: "failed" }),
    Object.freeze({ coach_profile_id: "coach-foreign", net_amount: 99000, status: "pending" }),
  ]),
})

function review(content, createdAt, overrides = {}) {
  return Object.freeze({
    coach_profile_id: "coach-owned",
    content,
    created_at: createdAt,
    hidden_reason: "must never escape",
    id: `review-${content}`,
    lesson_id: "lesson-owned",
    rating: 5,
    reviewer_id: "profile-reviewer",
    status: "visible",
    ...overrides,
  })
}

function notification(title, createdAt, overrides = {}) {
  return Object.freeze({
    body: `${title}-body`,
    created_at: createdAt,
    data: { rawPayload: "must never escape" },
    id: `notification-${title}`,
    read_at: null,
    title,
    user_id: "profile-owned",
    ...overrides,
  })
}

function createDashboardClient(
  rows = dashboardRows,
  failedTable = null,
  waitForConcurrent = false,
) {
  const calls = []
  const pending = []
  let reportConcurrentStart
  const concurrentQueriesStarted = new Promise((resolve) => {
    reportConcurrentStart = resolve
  })
  return {
    calls,
    from(table) {
      const call = { filters: [], limit: null, orders: [], select: null, table }
      calls.push(call)
      const builder = {
        eq(column, value) {
          call.filters.push({ column, kind: "eq", value })
          return builder
        },
        gte(column, value) {
          call.filters.push({ column, kind: "gte", value })
          return builder
        },
        in(column, values) {
          call.filters.push({ column, kind: "in", values: [...values] })
          return builder
        },
        is(column, value) {
          call.filters.push({ column, kind: "is", value })
          return builder
        },
        limit(value) {
          call.limit = value
          return builder
        },
        lt(column, value) {
          call.filters.push({ column, kind: "lt", value })
          return builder
        },
        order(column, options) {
          call.orders.push({ column, ...options })
          return builder
        },
        select(columns, options) {
          call.select = { columns, options: options ?? null }
          return builder
        },
        // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaitable.
        then(resolve, reject) {
          const result = runDashboardQuery(rows, call, failedTable)
          const query =
            waitForConcurrent && call.table !== "lessons"
              ? new Promise((release) => {
                  pending.push(() => release(result))
                  if (pending.length === 5) reportConcurrentStart()
                })
              : Promise.resolve(result)
          return query.then(resolve, reject)
        },
      }
      return builder
    },
    releaseAll() {
      for (const release of pending) release()
    },
    waitForConcurrentQueries() {
      return concurrentQueriesStarted
    },
  }
}

function runDashboardQuery(rows, call, failedTable) {
  if (call.table === failedTable) {
    return { count: null, data: null, error: { code: "PRIVATE", message: "sensitive" } }
  }
  let selected = [...(rows[call.table] ?? [])]
  for (const filter of call.filters) {
    selected = selected.filter((row) => {
      if (filter.kind === "eq" || filter.kind === "is") return row[filter.column] === filter.value
      if (filter.kind === "in") return filter.values.includes(row[filter.column])
      if (filter.kind === "gte") return row[filter.column] >= filter.value
      return row[filter.column] < filter.value
    })
  }
  for (const order of [...call.orders].reverse()) {
    selected.sort((left, right) => {
      const result = String(left[order.column]).localeCompare(String(right[order.column]))
      return order.ascending === false ? -result : result
    })
  }
  const count = selected.length
  if (call.limit !== null) selected = selected.slice(0, call.limit)
  const columns = call.select.columns.split(",")
  return {
    count: call.select.options?.count === "exact" ? count : null,
    data: selected.map((row) => Object.fromEntries(columns.map((column) => [column, row[column]]))),
    error: null,
  }
}

const expectedDashboard = Object.freeze({
  notifications: {
    items: [
      {
        body: "owned-unread-1-body",
        createdAt: "2026-08-29T04:00:00.000Z",
        title: "owned-unread-1",
      },
      {
        body: "owned-unread-2-body",
        createdAt: "2026-08-29T03:00:00.000Z",
        title: "owned-unread-2",
      },
      {
        body: "owned-unread-3-body",
        createdAt: "2026-08-29T02:00:00.000Z",
        title: "owned-unread-3",
      },
    ],
    unreadCount: 4,
  },
  pendingSettlements: { count: 2, totalNetAmount: 33000 },
  recentReviews: [
    {
      content: "visible-1",
      createdAt: "2026-08-29T04:00:00.000Z",
      lessonTitle: "테니스 입문",
      rating: 5,
    },
    {
      content: "visible-2",
      createdAt: "2026-08-29T03:00:00.000Z",
      lessonTitle: "주말 러닝",
      rating: 5,
    },
    {
      content: "visible-3",
      createdAt: "2026-08-29T02:00:00.000Z",
      lessonTitle: "테니스 입문",
      rating: 5,
    },
  ],
  reservations: {
    completionPending: 1,
    confirmed: 1,
    labels: { confirmed: "예약 확정", pending_payment: "결제 대기" },
    pendingPayment: 1,
  },
  todaySchedules: [
    {
      capacity: 4,
      endsAt: "2026-08-29T05:00:00.000Z",
      isOpen: true,
      lessonTitle: "테니스 입문",
      reservedCount: 1,
      startsAt: "2026-08-28T16:00:00.000Z",
    },
    {
      capacity: 4,
      endsAt: "2026-08-29T05:00:00.000Z",
      isOpen: true,
      lessonTitle: "주말 러닝",
      reservedCount: 1,
      startsAt: "2026-08-29T03:00:00.000Z",
    },
  ],
})

const expectedTrace = Object.freeze([
  {
    filters: [{ column: "coach_profile_id", kind: "eq", value: "coach-owned" }],
    limit: null,
    orders: [],
    select: { columns: "id,title", options: null },
    table: "lessons",
  },
  {
    filters: [
      { column: "lesson_id", kind: "in", values: ["lesson-owned", "lesson-second"] },
      { column: "starts_at", kind: "gte", value: "2026-08-28T15:00:00.000Z" },
      { column: "starts_at", kind: "lt", value: "2026-08-29T15:00:00.000Z" },
    ],
    limit: 8,
    orders: [
      { ascending: true, column: "starts_at" },
      { ascending: true, column: "id" },
    ],
    select: {
      columns: "capacity,ends_at,id,is_open,lesson_id,reserved_count,starts_at",
      options: null,
    },
    table: "lesson_schedules",
  },
  {
    filters: [
      { column: "coach_profile_id", kind: "eq", value: "coach-owned" },
      { column: "status", kind: "in", values: ["pending_payment", "confirmed"] },
    ],
    limit: null,
    orders: [],
    select: { columns: "status", options: null },
    table: "reservations",
  },
  {
    filters: [
      { column: "coach_profile_id", kind: "eq", value: "coach-owned" },
      { column: "status", kind: "eq", value: "pending" },
    ],
    limit: null,
    orders: [],
    select: { columns: "net_amount", options: null },
    table: "settlements",
  },
  {
    filters: [
      { column: "coach_profile_id", kind: "eq", value: "coach-owned" },
      { column: "status", kind: "eq", value: "visible" },
    ],
    limit: 3,
    orders: [
      { ascending: false, column: "created_at" },
      { ascending: false, column: "id" },
    ],
    select: { columns: "rating,content,created_at,lesson_id", options: null },
    table: "reviews",
  },
  {
    filters: [
      { column: "user_id", kind: "eq", value: "profile-owned" },
      { column: "read_at", kind: "is", value: null },
    ],
    limit: 3,
    orders: [
      { ascending: false, column: "created_at" },
      { ascending: false, column: "id" },
    ],
    select: { columns: "title,body,created_at", options: { count: "exact" } },
    table: "notifications",
  },
])

test("manual secure dashboard JSON returns exact redacted data and query trace", async () => {
  const client = createDashboardClient()
  const actual = await readCoachDashboard({
    client,
    coachProfileId: "coach-owned",
    now,
    profileId: "profile-owned",
  })

  assert.deepEqual(actual, expectedDashboard)
  assert.deepEqual(client.calls, expectedTrace)
  assert.doesNotMatch(
    JSON.stringify(actual),
    /review-|notification-|profile-|learner|hidden|rawPayload|gross_amount|coach_profile_id/u,
  )
  console.log(
    `MANUAL_SECURE_DASHBOARD_JSON ${JSON.stringify({ data: actual, trace: client.calls })}`,
  )
})

test("review notification and settlement queries return exact secure summaries", async () => {
  const actual = await readCoachDashboard({
    client: createDashboardClient(),
    coachProfileId: "coach-owned",
    now,
    profileId: "profile-owned",
  })
  assert.deepEqual(actual.recentReviews, expectedDashboard.recentReviews)
  assert.deepEqual(actual.notifications, expectedDashboard.notifications)
  assert.deepEqual(actual.pendingSettlements, expectedDashboard.pendingSettlements)
})

test("successful zero rows return exact empty and zero dashboard values", async () => {
  const emptyRows = Object.fromEntries(Object.keys(dashboardRows).map((table) => [table, []]))
  const actual = await readCoachDashboard({
    client: createDashboardClient(emptyRows),
    coachProfileId: "coach-owned",
    now,
    profileId: "profile-owned",
  })
  assert.deepEqual(actual, {
    notifications: { items: [], unreadCount: 0 },
    pendingSettlements: { count: 0, totalNetAmount: 0 },
    recentReviews: [],
    reservations: {
      completionPending: 0,
      confirmed: 0,
      labels: { confirmed: "예약 확정", pending_payment: "결제 대기" },
      pendingPayment: 0,
    },
    todaySchedules: [],
  })
})

test("starts all five independent reads concurrently after owned lessons resolve", async () => {
  const client = createDashboardClient(dashboardRows, null, true)
  const resultPromise = readCoachDashboard({
    client,
    coachProfileId: "coach-owned",
    now,
    profileId: "profile-owned",
  })

  await client.waitForConcurrentQueries()
  assert.deepEqual(
    client.calls.map((call) => call.table),
    ["lessons", "lesson_schedules", "reservations", "settlements", "reviews", "notifications"],
  )
  client.releaseAll()
  await assert.doesNotReject(resultPromise)
})

test("each dashboard query failure throws the typed whole-read failure", async (t) => {
  for (const table of Object.keys(dashboardRows)) {
    await t.test(table, async () => {
      await assert.rejects(
        readCoachDashboard({
          client: createDashboardClient(dashboardRows, table),
          coachProfileId: "coach-owned",
          now,
          profileId: "profile-owned",
        }),
        (error) => {
          assert.ok(error instanceof CoachDashboardReadError)
          assert.equal(error.code, "COACH_DASHBOARD_READ_FAILED")
          assert.doesNotMatch(error.message, /PRIVATE|sensitive/u)
          return true
        },
      )
    })
  }
})

test("malformed row timestamps and amounts throw the typed read error", async (t) => {
  const malformedCases = [
    [
      "schedule timestamp",
      "lesson_schedules",
      { ...dashboardRows.lesson_schedules[0], ends_at: "invalid" },
    ],
    ["review timestamp", "reviews", { ...dashboardRows.reviews[0], created_at: "invalid" }],
    [
      "notification timestamp",
      "notifications",
      { ...dashboardRows.notifications[0], created_at: "invalid" },
    ],
    ["settlement amount", "settlements", { ...dashboardRows.settlements[0], net_amount: "12000" }],
  ]
  for (const [name, table, malformed] of malformedCases) {
    await t.test(name, async () => {
      const rows = { ...dashboardRows, [table]: [malformed, ...dashboardRows[table].slice(1)] }
      await assert.rejects(
        readCoachDashboard({
          client: createDashboardClient(rows),
          coachProfileId: "coach-owned",
          now,
          profileId: "profile-owned",
        }),
        CoachDashboardReadError,
      )
    })
  }
})
