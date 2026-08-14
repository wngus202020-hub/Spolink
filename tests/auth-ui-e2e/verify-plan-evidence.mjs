#!/usr/bin/env node
import { readFile } from "node:fs/promises"

import { finalQaHypotheses, finalQaProjects, finalQaScenarioNames } from "./contracts.mjs"

const requiredDocPhrases = [
  "이메일/비밀번호로 기본 인증 계정만 생성한다",
  "/onboarding/profile",
  "소셜 로그인은 MVP 인증 화면에 노출하지 않고 후속 단계에서 검토한다",
  "관심 종목 영구 저장은 MVP 범위에서 연기",
  "목적 선택은 다음 이동 경로를 정하는 UI 상태",
]

async function main() {
  const [mode, targetPath] = process.argv.slice(2)
  if (!mode) throw new Error("verify-plan-evidence requires a mode")
  if (mode === "compliance") {
    await verifyCompliance(targetPath)
  } else if (mode === "review-work") {
    await verifyReview(targetPath)
  } else if (mode === "manual-qa") {
    await verifyManualQa(targetPath)
  } else if (mode === "final") {
    await verifyFinal()
  } else {
    throw new Error(`Unknown verify-plan-evidence mode: ${mode}`)
  }
  console.log(JSON.stringify({ mode, verdict: "APPROVE" }))
}

async function verifyCompliance(planPath) {
  if (!planPath) throw new Error("compliance mode requires a plan path")
  const plan = await readFile(planPath, "utf8")
  for (const phrase of ["Must have", "Must NOT have", "Lock the approved screen contract"]) {
    if (!plan.includes(phrase)) throw new Error(`Plan is missing ${phrase}`)
  }
  const screen = await readFile("SPOLINK_화면_설계.md", "utf8")
  for (const phrase of requiredDocPhrases) {
    if (!screen.includes(phrase)) throw new Error(`Screen contract is missing: ${phrase}`)
  }
}

async function verifyReview(summaryPath) {
  const summary = await readJson(summaryPath, "review-work")
  assertVerdict(summary.verdict)
  if (!Array.isArray(summary.lanes) || summary.lanes.length !== 5) {
    throw new Error("review-work summary must contain five lanes")
  }
  for (const lane of summary.lanes) {
    assertVerdict(lane.verdict)
    if (!Array.isArray(lane.checks) || lane.checks.length === 0) {
      throw new Error(`review-work lane has no checks: ${lane.name ?? "unknown"}`)
    }
    for (const check of lane.checks) {
      if (check.exitCode !== 0) throw new Error(`review-work check failed: ${check.command}`)
      if (!/^[a-f0-9]{64}$/.test(check.resultHash)) {
        throw new Error(`review-work check hash is invalid: ${check.command}`)
      }
    }
  }
}

async function verifyManualQa(summaryPath) {
  const summary = await readJson(summaryPath, "manual-qa")
  assertVerdict(summary.verdict)
  assertManualQaHypotheses(summary.hypotheses)
  assertManualQaScenarios(summary.scenarios)
  if (summary.consoleErrorCount !== 0) throw new Error("manual-qa console errors must be zero")
  if (summary.networkFailureCount !== 0) throw new Error("manual-qa network failures must be zero")
  if (summary.runtimeObserved !== true)
    throw new Error("manual-qa must record live runtime observation")
  if (summary.cleanup?.verdict !== "APPROVE") {
    throw new Error("manual-qa cleanup must approve")
  }
}

async function verifyFinal() {
  await Promise.all([
    readFile(".omo/evidence/f1-supabase-auth-ui-session.jsonl", "utf8"),
    readFile(".omo/evidence/f2-supabase-auth-ui-session.jsonl", "utf8"),
    readFile(".omo/evidence/f3-supabase-auth-ui-session.jsonl", "utf8"),
    readFile(".omo/evidence/f4-supabase-auth-ui-session.jsonl", "utf8"),
  ])
}

async function readJson(filePath, label) {
  if (!filePath) throw new Error(`${label} mode requires a summary path`)
  return JSON.parse(await readFile(filePath, "utf8"))
}

function assertVerdict(verdict) {
  if (verdict !== "APPROVE") throw new Error("summary verdict must APPROVE")
}

function assertManualQaHypotheses(hypotheses) {
  if (!Array.isArray(hypotheses)) throw new Error("manual-qa hypotheses must be an array")
  const expected = finalQaProjects.flatMap((project) =>
    finalQaHypotheses.map((name) => `${project}:${name}`),
  )
  const actual = hypotheses.map((item) => `${item.project}:${item.name}`).sort()
  assertExactList("manual-qa hypotheses", actual, expected.sort())
  for (const item of hypotheses) {
    if (item.status !== "passed") throw new Error(`manual-qa hypothesis did not pass: ${item.name}`)
    assertVerdict(item.verdict)
    assertSha(item.resultHash, `manual-qa hypothesis hash: ${item.name}`)
  }
}

function assertManualQaScenarios(scenarios) {
  if (!Array.isArray(scenarios)) throw new Error("manual-qa scenarios must be an array")
  const expected = finalQaProjects.flatMap((project) =>
    finalQaScenarioNames.map((name) => `${project}:${name}`),
  )
  const actual = scenarios.map((item) => `${item.project}:${item.name}`).sort()
  assertExactList("manual-qa scenarios", actual, expected.sort())
  for (const item of scenarios) {
    if (item.status !== "passed") throw new Error(`manual-qa scenario did not pass: ${item.name}`)
    assertVerdict(item.verdict)
    assertSha(item.resultHash, `manual-qa scenario hash: ${item.name}`)
  }
}

function assertExactList(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} mismatch: ${JSON.stringify({ actual, expected })}`)
  }
}

function assertSha(value, label) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be SHA-256`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
