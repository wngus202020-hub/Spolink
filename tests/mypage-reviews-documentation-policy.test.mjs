import assert from "node:assert/strict"
import test from "node:test"

import {
  bullets,
  inlineCode,
  normalizeCondition,
  readDocument,
  section,
  tableRecords,
} from "./mypage-reviews-documentation-helpers.mjs"

test("Given the owner review policy, when policy and RLS matrices are parsed, then access sets are mutually exclusive", async () => {
  const [servicePolicy, erd] = await Promise.all([
    readDocument("SPOLINK_서비스_정책서.md"),
    readDocument("SPOLINK_ERD.md"),
  ])
  assertPolicySemantics(servicePolicy)
  assertRlsSemantics(erd)
})

test("policy mutation probes tolerate prose changes and reject hidden or deleted access drift", async () => {
  const [servicePolicy, erd] = await Promise.all([
    readDocument("SPOLINK_서비스_정책서.md"),
    readDocument("SPOLINK_ERD.md"),
  ])
  assert.doesNotThrow(() => assertPolicySemantics(servicePolicy.replace("노출 중", "공개 상태")))
  assert.throws(() =>
    assertPolicySemantics(servicePolicy.replace("`visible`과 `hidden`", "`visible`")),
  )
  assert.throws(() =>
    assertRlsSemantics(
      erd.replace("status IN ('visible', 'hidden')", "status IN ('visible', 'deleted')"),
    ),
  )
})

function assertPolicySemantics(markdown) {
  const reviewPolicy = section(markdown, "## 리뷰 정책")
  const states = tableRecords(section(reviewPolicy, "### 리뷰 상태")).map((row) => row["상태"])
  assert.deepEqual(states, ["visible", "hidden", "deleted"])
  const codedBullets = bullets(section(reviewPolicy, "### 리뷰 상태")).map((entry) => entry.code)
  assert.equal(
    codedBullets.some((tokens) => assertTokenMultiset(tokens, ["hidden", "hidden", "visible"])),
    true,
  )
  assert.equal(
    codedBullets.some((tokens) => tokens.length === 1 && tokens[0] === "deleted"),
    true,
  )
}

function assertTokenMultiset(actual, expected) {
  return actual.toSorted().join("|") === expected.toSorted().join("|")
}

function assertRlsSemantics(markdown) {
  const rows = tableRecords(section(section(markdown, "## RLS 기준"), "### 리뷰 SELECT 정책"))
  assert.equal(rows.length, 2)
  const byPolicy = new Map(rows.map((row) => [inlineCode(row["정책"])[0], row]))
  assert.deepEqual(
    [...byPolicy.keys()],
    ["reviews_public_visible_only", "reviews_owner_visible_hidden_select"],
  )
  assert.equal(
    normalizeCondition(byPolicy.get("reviews_public_visible_only")["조건"]),
    "status = 'visible'",
  )
  assert.equal(
    normalizeCondition(byPolicy.get("reviews_owner_visible_hidden_select")["조건"]),
    "reviewer_id = auth.uid() AND status IN ('visible', 'hidden')",
  )
  assert.equal(inlineCode(section(markdown, "### 리뷰 SELECT 정책")).includes("deleted"), true)
}
