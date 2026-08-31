import assert from "node:assert/strict"
import test from "node:test"

import {
  bullets,
  fencedBlocks,
  inlineCode,
  labeledBlock,
  readDocument,
  section,
  tableRecords,
} from "./mypage-reviews-documentation-helpers.mjs"

test("Given the review screen contract, when state and navigation sections are parsed, then every state has one behavior", async () => {
  const screen = await readDocument("SPOLINK_화면_설계.md")
  assertScreenSemantics(screen)
})

test("Given Review Card guidance, when structured rules are parsed, then the owner variant keeps accessibility semantics", async () => {
  const [design, mypageGuide, e2eGuide] = await Promise.all([
    readDocument("SPOLINK_디자인_시스템.md"),
    readDocument("app/mypage/AGENTS.md"),
    readDocument("tests/auth-ui-e2e/AGENTS.md"),
  ])
  assertDesignSemantics(design)
  const guideTokens = new Set(inlineCode(mypageGuide))
  for (const token of [
    "/mypage/reviews",
    "ready",
    "empty",
    "out_of_range",
    "read_failure",
    "loading",
    "error",
  ]) {
    assert.equal(guideTokens.has(token), true)
  }
  assert.equal(
    e2eGuide.includes(
      "node tests/auth-ui-e2e/run-mypage-reviews.mjs .omo/evidence/mypage-reviews-management/task-8/focused-summary.json",
    ),
    true,
  )
})

test("screen and design mutation probes tolerate copy but reject state navigation and target drift", async () => {
  const [screen, design] = await Promise.all([
    readDocument("SPOLINK_화면_설계.md"),
    readDocument("SPOLINK_디자인_시스템.md"),
  ])
  assert.doesNotThrow(() =>
    assertScreenSemantics(screen.replace("목적과 읽기 경계", "읽기 목적과 경계")),
  )
  assert.throws(() => assertScreenSemantics(screen.replace("| loading |", "| waiting |")))
  assert.throws(() => assertScreenSemantics(screen.replace("`내 리뷰 보기`", "내 리뷰 보기")))
  assert.throws(() => assertDesignSemantics(design.replace("최소 44px 높이", "최소 40px 높이")))
})

test("Given local verification sections, when claim scope is parsed, then remote environments are not claimed", async () => {
  const [api, screen] = await Promise.all([
    readDocument("SPOLINK_API_명세서.md"),
    readDocument("SPOLINK_화면_설계.md"),
  ])
  const scoped = `${section(section(api, "## 리뷰 API"), "### 내 리뷰 관리 읽기")}\n${section(screen, "## 16-1. 내 리뷰 관리")}`
  assert.doesNotMatch(
    scoped,
    /(?:hosted|production|provider)[^\n]*(?:검증했다|완료했다|통과했다)/iu,
  )
})

function assertScreenSemantics(markdown) {
  const ownerScreen = section(markdown, "## 16-1. 내 리뷰 관리")
  assert.deepEqual(fencedBlocks(ownerScreen, "text"), ["/mypage/reviews"])
  const stateRows = tableRecords(labeledBlock(ownerScreen, "상태:"))
  assert.deepEqual(
    stateRows.map((row) => row["상태"]),
    ["ready", "empty", "out_of_range", "read_failure", "loading", "error"],
  )
  assert.equal(new Set(stateRows.map((row) => row["화면 동작"])).size, stateRows.length)
  const navigation = bullets(labeledBlock(ownerScreen, "내비게이션:"))
  assert.deepEqual(
    navigation.map((entry) => entry.code),
    [["리뷰 내역 보기"], ["내 리뷰 보기"]],
  )
}

function assertDesignSemantics(markdown) {
  const card = section(markdown, "### 5.15 Review Card")
  const ownerVariant = labeledBlock(card, "Owner management variant:")
  const rules = bullets(ownerVariant)
  assert.equal(rules.length, 5)
  assert.equal(
    rules.some((rule) => rule.code.includes("hidden")),
    true,
  )
  assert.equal(
    rules.some((rule) => rule.text.includes("44px")),
    true,
  )
  assert.equal(
    rules.some((rule) => rule.code.includes("StatusBadge")),
    true,
  )
}
