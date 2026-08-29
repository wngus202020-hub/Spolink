import { registerHooks } from "node:module"

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

export {
  CoachDashboardReadError,
  getKstDayWindow,
  readCoachDashboard,
  summarizeCoachReservations,
  summarizeCoachSchedules,
}

export const now = new Date("2026-08-29T03:00:00.000Z")

export function schedule(id, startsAt, overrides = {}) {
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

export function review(content, createdAt, overrides = {}) {
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

export function notification(title, createdAt, overrides = {}) {
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

export function createDashboardClient(rows, failedTable = null, waitForConcurrent = false) {
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
