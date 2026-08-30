import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const workspace = mkdtempSync(path.join(tmpdir(), "spolink-review-read-"))
const output = path.join(workspace, "dist")
const config = path.join(workspace, "tsconfig.json")
const compiledModel = path.join(output, "lib/reviews/read-model.js")
let compiled = false

writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      baseUrl: root,
      esModuleInterop: true,
      module: "CommonJS",
      moduleResolution: "Node",
      noEmit: false,
      outDir: output,
      paths: { "@/*": [path.join(root, "*")] },
      rootDir: root,
      skipLibCheck: true,
      strict: true,
      target: "ES2022",
    },
    files: [path.join(root, "lib/reviews/read-model.ts")],
  }),
  { mode: 0o600 },
)
process.once("exit", () => rmSync(workspace, { force: true, recursive: true }))

async function importReviewModel(name) {
  if (!compiled) {
    execFileSync(path.join(root, "node_modules/.bin/tsc"), ["--project", config], {
      cwd: root,
      stdio: "pipe",
    })
    compiled = true
  }
  const loaded = await import(
    `${pathToFileURL(compiledModel).href}?test=${encodeURIComponent(name)}`
  )
  return loaded.default
}

test("review history normalizes every malformed page class", async () => {
  // Given: the final product facade is loaded only inside this registered test.
  const { normalizeReviewHistoryPage, REVIEWS_PER_PAGE } = await importReviewModel("normalization")
  const malformed = [undefined, ["2"], "0", "-1", "1.5", "9007199254740992", "abc"]
  // When: every Next search-param shape crosses the parser.
  const actual = malformed.map(normalizeReviewHistoryPage)
  // Then: malformed values become page one and valid positive safe integers survive.
  assert.deepEqual(actual, [1, 1, 1, 1, 1, 1, 1])
  assert.equal(normalizeReviewHistoryPage("2"), 2)
  assert.equal(REVIEWS_PER_PAGE, 20)
})

test("review snapshot scopes owner rows before unique enrichment", async () => {
  // Given: two owned rows share a lesson and coach.
  const { readReviewHistorySnapshot } = await importReviewModel("owner-first")
  const calls = []
  const dependencies = {
    readOwnedReviews: async (learnerId, first, last) => {
      calls.push(["owner", learnerId, first, last])
      return {
        kind: "found",
        reviews: [review(), review({ id: "review-hidden", status: "hidden" })],
        totalCount: 21,
      }
    },
    enrichOwnedReviews: async (lessonIds, coachIds) => {
      calls.push(["enrich", lessonIds, coachIds])
      return { coaches: [coach()], kind: "found", lessons: [lesson()] }
    },
  }
  // When: page two is read.
  const actual = await readReviewHistorySnapshot("learner-owned", 2, dependencies)
  // Then: owner scope precedes service enrichment with exact range and unique owned IDs.
  assert.equal(actual.kind, "found")
  assert.deepEqual(calls, [
    ["owner", "learner-owned", 20, 39],
    ["enrich", ["lesson-owned"], ["coach-owned"]],
  ])
})

test("review snapshot never enriches empty failed or thrown owner reads", async () => {
  // Given: all owner outcomes without established rows.
  const { readReviewHistorySnapshot } = await importReviewModel("owner-short-circuit")
  const reads = [
    async () => ({ kind: "found", reviews: [], totalCount: 0 }),
    async () => ({ kind: "read_failure" }),
    async () => {
      throw new Error("owner unavailable")
    },
  ]
  let enrichCalls = 0
  // When: every owner outcome crosses the query orchestrator.
  const actual = []
  for (const readOwnedReviews of reads) {
    const result = await readReviewHistorySnapshot("learner-owned", 1, {
      readOwnedReviews,
      enrichOwnedReviews: async () => {
        enrichCalls += 1
        return { coaches: [], kind: "found", lessons: [] }
      },
    })
    actual.push(result.kind)
  }
  // Then: no service enrichment occurs and empty remains distinct from failures.
  assert.equal(enrichCalls, 0)
  assert.deepEqual(actual, ["found", "read_failure", "read_failure"])
})

test("review history distinguishes empty out of range and unavailable reads", async () => {
  // Given: empty, later empty, returned failure, and thrown failure readers.
  const { readReviewHistoryData } = await importReviewModel("data-states")
  const thrownRead = async () => {
    throw new Error("read unavailable")
  }
  // When: each result is projected.
  const actual = await Promise.all([
    readReviewHistoryData("owner", 1, async () => found({ reviews: [], totalCount: 0 })),
    readReviewHistoryData("owner", 3, async () => found({ reviews: [], totalCount: 21 })),
    readReviewHistoryData("owner", 1, async () => ({ kind: "read_failure" })),
    readReviewHistoryData("owner", 1, thrownRead),
  ])
  // Then: all four observable states remain explicit and safe.
  assert.deepEqual(
    actual.map((entry) => entry.state),
    ["empty", "out_of_range", "read_failure", "read_failure"],
  )
  assert.equal(actual[2].viewModel, null)
  assert.equal(actual[3].viewModel, null)
})

test("review snapshot converts enrichment failure and throw", async () => {
  // Given: one established owner row.
  const { readReviewHistorySnapshot } = await importReviewModel("enrichment-failure")
  const readOwnedReviews = async () => ({
    kind: "found",
    reviews: [review()],
    totalCount: 1,
  })
  // When: enrichment returns failure or throws.
  const actual = await Promise.all([
    readReviewHistorySnapshot("owner", 1, {
      readOwnedReviews,
      enrichOwnedReviews: async () => ({ kind: "read_failure" }),
    }),
    readReviewHistorySnapshot("owner", 1, {
      readOwnedReviews,
      enrichOwnedReviews: async () => {
        throw new Error("service unavailable")
      },
    }),
  ])
  // Then: raw service failures collapse to the safe failure union.
  assert.deepEqual(actual, [{ kind: "read_failure" }, { kind: "read_failure" }])
})

test("review history keeps exact twenty one row pagination stable on timestamp ties", async () => {
  // Given: 21 rows share a timestamp in descending ID query order.
  const { readReviewHistoryData, REVIEWS_PER_PAGE } = await importReviewModel("stable-pagination")
  const rows = Array.from({ length: 21 }, (_, index) =>
    review({ id: `review-${String(index + 1).padStart(2, "0")}` }),
  ).reverse()
  const read = async (_owner, page) =>
    found({
      reviews: rows.slice((page - 1) * REVIEWS_PER_PAGE, page * REVIEWS_PER_PAGE),
      totalCount: 21,
    })
  // When: both pages are projected.
  const [first, second] = await Promise.all([
    readReviewHistoryData("owner", 1, read),
    readReviewHistoryData("owner", 2, read),
  ])
  // Then: the boundary is 20/1 and ID descending breaks timestamp ties.
  assert.equal(first.viewModel.items.length, 20)
  assert.equal(second.viewModel.items.length, 1)
  assert.deepEqual(
    [first.viewModel.items[0].key, first.viewModel.items[19].key, second.viewModel.items[0].key],
    ["review-21", "review-02", "review-01"],
  )
  assert.equal(first.viewModel.totalPages, 2)
})

test("review history presents safe Korean visible and hidden rows", async () => {
  // Given: visible and hidden rows with nullable content and an unavailable lesson.
  const { readReviewHistoryData } = await importReviewModel("safe-presentation")
  const snapshot = found({
    coaches: [coach(), coach({ id: "coach-unapproved", status: "submitted" })],
    lessons: [
      lesson(),
      lesson({
        coachProfileId: "coach-unapproved",
        id: "lesson-paused",
        status: "paused",
        title: "운영 중단 레슨",
      }),
    ],
    reviews: [
      review(),
      review({
        coachProfileId: "coach-unapproved",
        content: null,
        hiddenReason: "운영 정책 위반",
        id: "review-hidden",
        lessonId: "lesson-paused",
        rating: 3,
        status: "hidden",
      }),
    ],
    totalCount: 2,
  })
  // When: the real data and presentation path executes.
  const actual = await readReviewHistoryData("owner", 1, async () => snapshot)
  // Then: Korean labels, fallbacks, hidden reason, and active-only href are safe.
  assert.deepEqual(
    actual.viewModel.items.map((item) => ({
      content: item.content,
      hiddenReason: item.hiddenReason,
      href: item.lessonHref,
      label: item.status.label,
      tone: item.status.tone,
    })),
    [
      {
        content: "친절하고 알찬 수업이었습니다.",
        hiddenReason: null,
        href: "/lessons/lesson-owned",
        label: "공개 중",
        tone: "success",
      },
      {
        content: "작성한 내용이 없습니다.",
        hiddenReason: "운영 정책 위반",
        href: null,
        label: "숨김",
        tone: "warning",
      },
    ],
  )
  assert.doesNotMatch(
    JSON.stringify(actual),
    /reviewer|learner|owner|profileId|profile_id|service.role|provider|raw|error|deleted/iu,
  )
})

test("review href requires active lesson matching an approved coach", async () => {
  // Given: closed, paused, unapproved, mismatched, and missing lesson histories.
  const { readReviewHistoryData } = await importReviewModel("href-eligibility")
  const snapshot = found({
    coaches: [
      coach(),
      coach({ id: "coach-other" }),
      coach({ id: "coach-unapproved", status: "submitted" }),
    ],
    lessons: [
      lesson({ id: "lesson-closed", status: "closed" }),
      lesson({ id: "lesson-paused", status: "paused" }),
      lesson({ coachProfileId: "coach-unapproved", id: "lesson-unapproved" }),
      lesson({ coachProfileId: "coach-other", id: "lesson-mismatch" }),
    ],
    reviews: [
      review({ id: "review-closed", lessonId: "lesson-closed" }),
      review({ id: "review-paused", lessonId: "lesson-paused" }),
      review({
        coachProfileId: "coach-unapproved",
        id: "review-unapproved",
        lessonId: "lesson-unapproved",
      }),
      review({ id: "review-mismatch", lessonId: "lesson-mismatch" }),
      review({ id: "review-missing", lessonId: "lesson-missing" }),
    ],
    totalCount: 5,
  })
  // When: every unavailable class is projected.
  const actual = await readReviewHistoryData("owner", 1, async () => snapshot)
  // Then: none gets a link and missing enrichment uses a safe title.
  assert.deepEqual(
    actual.viewModel.items.map((item) => item.lessonHref),
    [null, null, null, null, null],
  )
  assert.equal(
    actual.viewModel.items.find((item) => item.key === "review-missing").lessonTitle,
    "더 이상 공개되지 않는 레슨",
  )
})

test("actual query pins owner visibility exact count order and service boundary", async () => {
  // Given: the final product module succeeds before its default adapter is inspected.
  await importReviewModel("query-contract")
  const source = await readFile(new URL("../lib/reviews/read-query.ts", import.meta.url), "utf8")
  // When: owner and privileged query regions are separated.
  const serviceStart = source.indexOf("async function enrichOwnedReviews")
  const ownerQuery = source.slice(source.indexOf("async function readOwnedReviews"), serviceStart)
  const serviceQuery = source.slice(serviceStart)
  // Then: foreign/deleted rows are excluded before service creation and ordering is exact.
  assert.match(ownerQuery, /count: "exact"/u)
  assert.match(ownerQuery, /\.eq\("reviewer_id", learnerId\)/u)
  assert.match(ownerQuery, /\.in\("status", \["visible", "hidden"\]\)/u)
  assert.ok(
    ownerQuery.indexOf('.order("created_at", { ascending: false })') <
      ownerQuery.indexOf('.order("id", { ascending: false })'),
  )
  assert.match(ownerQuery, /\.range\(firstRow, lastRow\)/u)
  assert.doesNotMatch(ownerQuery, /createSupabaseServiceClient/u)
  assert.match(serviceQuery, /createSupabaseServiceClient\(\)/u)
  assert.match(serviceQuery, /\.in\("id", lessonIds\)/u)
  assert.match(serviceQuery, /\.in\("id", coachIds\)/u)
})

test("review modules stay strict bounded and expose only the intended facade", async () => {
  // Given: all five final product modules and runtime exports.
  const model = await importReviewModel("strict-surface")
  const paths = [
    "../lib/reviews/read-types.ts",
    "../lib/reviews/read-presentation.ts",
    "../lib/reviews/read-query.ts",
    "../lib/reviews/read-data.ts",
    "../lib/reviews/read-model.ts",
  ]
  // When: source lines and forbidden escape hatches are inspected.
  const sources = await Promise.all(
    paths.map((entry) => readFile(new URL(entry, import.meta.url), "utf8")),
  )
  // Then: every module stays below 250 lines with no unsafe TypeScript escape hatch.
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
      /\bas\s+(?:any|unknown)\b|@ts-(?:ignore|expect-error)|:\s*any\b|(?<![=!])!(?=[.;,\)])/u,
    )
  }
})

function review(overrides = {}) {
  return {
    coachProfileId: "coach-owned",
    content: "친절하고 알찬 수업이었습니다.",
    createdAt: "2026-08-30T15:00:00.000Z",
    hiddenReason: null,
    id: "review-visible",
    lessonId: "lesson-owned",
    rating: 5,
    status: "visible",
    ...overrides,
  }
}

function lesson(overrides = {}) {
  return {
    coachProfileId: "coach-owned",
    id: "lesson-owned",
    status: "active",
    title: "입문 테니스 레슨",
    ...overrides,
  }
}

function coach(overrides = {}) {
  return { id: "coach-owned", status: "approved", ...overrides }
}

function found(overrides = {}) {
  return {
    coaches: [coach()],
    kind: "found",
    lessons: [lesson()],
    reviews: [review()],
    totalCount: 1,
    ...overrides,
  }
}
