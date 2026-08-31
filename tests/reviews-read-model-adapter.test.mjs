import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { importReviewModel, importReviewQuery } from "./reviews-read-model-compiler.mjs"

const runtimeKey = Symbol.for("spolink.review-query-runtime")

test("actual owner adapter scopes and orders before privileged enrichment", async () => {
  const events = []
  globalThis[runtimeKey] = createQueryRuntime(events)
  const { readReviewHistorySnapshot } = await importReviewModel("actual-owner-adapter")
  const actual = await readReviewHistorySnapshot("learner-owned", 2)
  assert.equal(actual.kind, "found")
  assert.deepEqual(events, [
    ["owner", "from", "reviews"],
    ["owner", "select", { count: "exact" }],
    ["owner", "eq", "reviewer_id", "learner-owned"],
    ["owner", "in", "status", ["visible", "hidden"]],
    ["owner", "order", "created_at", false],
    ["owner", "order", "id", false],
    ["owner", "range", 20, 39],
    ["service", "create"],
    ["service", "from", "lessons"],
    ["service", "in", "id", ["lesson-owned"]],
    ["service", "from", "coach_profiles"],
    ["service", "in", "id", ["coach-owned"]],
  ])
})

test("actual owner adapter never creates service access after an owner failure", async () => {
  const events = []
  globalThis[runtimeKey] = createQueryRuntime(events, { ownerError: { code: "42501" } })
  const { readReviewHistorySnapshot } = await importReviewModel("actual-owner-failure")
  assert.deepEqual(await readReviewHistorySnapshot("learner-owned", 1), {
    kind: "read_failure",
  })
  assert.equal(
    events.some(([scope]) => scope === "service"),
    false,
  )
})

test("owner adapter probe rejects security and ordering mutations in a disposable compile", async () => {
  const events = []
  globalThis[runtimeKey] = createQueryRuntime(events)
  const { readReviewHistorySnapshot } = await importReviewModel("mutated-owner-adapter", {
    "read-query.ts": (source) =>
      source
        .replace('.eq("reviewer_id", learnerId)', '.eq("lesson_id", learnerId)')
        .replace(
          '.order("created_at", { ascending: false })\n    .order("id", { ascending: false })',
          '.order("id", { ascending: false })\n    .order("created_at", { ascending: false })',
        ),
  })
  await readReviewHistorySnapshot("learner-owned", 2)
  assert.notDeepEqual(events.slice(2, 7), [
    ["owner", "eq", "reviewer_id", "learner-owned"],
    ["owner", "in", "status", ["visible", "hidden"]],
    ["owner", "order", "created_at", false],
    ["owner", "order", "id", false],
    ["owner", "range", 20, 39],
  ])
})

test("PGRST103 behavior probe rejects a semantic mutation but ignores harmless copy", async () => {
  const harmless = await importReviewQuery("harmless-copy", {
    "read-query.ts": (source) => `// harmless copy change\n${source}`,
  })
  assert.deepEqual(await exerciseRangeRecovery(harmless), {
    recountCalls: 1,
    result: { kind: "found", reviews: [], totalCount: 21 },
  })
  const mutated = await importReviewQuery("wrong-range-code", {
    "read-query.ts": (source) => source.replace("PGRST103", "PGRST999"),
  })
  assert.notDeepEqual(await exerciseRangeRecovery(mutated), {
    recountCalls: 1,
    result: { kind: "found", reviews: [], totalCount: 21 },
  })
})

test("review modules stay strict bounded and expose only the intended facade", async () => {
  const model = await importReviewModel("strict-surface")
  const paths = [
    "../lib/reviews/read-types.ts",
    "../lib/reviews/read-presentation.ts",
    "../lib/reviews/read-query.ts",
    "../lib/reviews/read-data.ts",
    "../lib/reviews/read-model.ts",
  ]
  const sources = await Promise.all(
    paths.map((entry) => readFile(new URL(entry, import.meta.url), "utf8")),
  )
  assert.deepEqual(
    Object.keys(model)
      .filter((name) => name !== "default" && name !== "module.exports")
      .sort(),
    [
      "REVIEWS_PER_PAGE",
      "buildReviewHistoryItems",
      "normalizeReviewHistoryPage",
      "readReviewHistoryData",
      "readReviewHistorySnapshot",
    ],
  )
  for (const source of sources) {
    assert.ok(source.split("\n").length < 250)
    assert.doesNotMatch(
      source,
      /\bas\s+(?:any|unknown)\b|@ts-(?:ignore|expect-error)|:\s*any\b|(?<![=!])!(?=[.;,)])/u,
    )
  }
})

async function exerciseRangeRecovery(query) {
  let recountCalls = 0
  const result = await query.mapOwnedReviewQueryResult(
    { count: null, data: null, error: { code: "PGRST103" } },
    async () => {
      recountCalls += 1
      return { count: 21, error: null }
    },
  )
  return { recountCalls, result }
}

function createQueryRuntime(events, { ownerError = null } = {}) {
  return {
    createServiceClient() {
      events.push(["service", "create"])
      return createServiceClient(events)
    },
    ownerClient: {
      from(table) {
        events.push(["owner", "from", table])
        return createOwnerQuery(events, ownerError)
      },
    },
  }
}

function createOwnerQuery(events, ownerError) {
  const result = {
    count: ownerError ? null : 1,
    data: ownerError
      ? null
      : [
          {
            coach_profile_id: "coach-owned",
            content: "review",
            created_at: "2026-08-30T15:00:00.000Z",
            hidden_reason: null,
            id: "review-owned",
            lesson_id: "lesson-owned",
            rating: 5,
            status: "visible",
          },
        ],
    error: ownerError,
  }
  const query = {
    eq(column, value) {
      events.push(["owner", "eq", column, value])
      return query
    },
    in(column, values) {
      events.push(["owner", "in", column, values])
      return query
    },
    order(column, options) {
      events.push(["owner", "order", column, options.ascending])
      return query
    },
    range(first, last) {
      events.push(["owner", "range", first, last])
      return Promise.resolve(result)
    },
    select(_columns, options) {
      events.push(["owner", "select", options])
      return query
    },
  }
  return query
}

function createServiceClient(events) {
  return {
    from(table) {
      events.push(["service", "from", table])
      return {
        select() {
          return {
            in(column, values) {
              events.push(["service", "in", column, values])
              const data =
                table === "lessons"
                  ? [
                      {
                        coach_profile_id: "coach-owned",
                        id: "lesson-owned",
                        status: "active",
                        title: "lesson",
                      },
                    ]
                  : [{ id: "coach-owned", status: "approved" }]
              return Promise.resolve({ data, error: null })
            },
          }
        },
      }
    },
  }
}
