import assert from "node:assert/strict"
import { statSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeProfileEditTerminalReceipt } from "./auth-ui-e2e/mypage-profile-edit-terminal-receipt.mjs"
import {
  assertMode600,
  docsPaths,
  fileBinding,
  packagePath,
  readJson,
  readText,
  screenDocPath,
  sha256Text,
  task7EvidencePath,
} from "./mypage-profile-edit-docs-helpers.mjs"

const receiptPath = ".omo/evidence/mypage-profile-edit/support/task-7-evidence-closure-receipt.json"
const supersessionPath =
  ".omo/evidence/mypage-profile-edit/support/task-8-legacy-matrix-supersession-receipt.json"
const visualDir = ".omo/evidence/mypage-profile-edit/task-7-visual"
const observationsPath = `${visualDir}/observations.jsonl`

const expectedPngs = [
  {
    name: "profile-edit-success-desktop-chromium.png",
    state: "success",
    project: "desktop-chromium",
    width: 1280,
    height: 800,
  },
  {
    name: "profile-edit-success-tablet-chromium.png",
    state: "success",
    project: "tablet-chromium",
    width: 768,
    height: 1024,
  },
  {
    name: "profile-edit-success-mobile-chromium.png",
    state: "success",
    project: "mobile-chromium",
    width: 390,
    height: 844,
  },
  {
    name: "profile-edit-validation-mobile-chromium.png",
    state: "validation",
    project: "mobile-chromium",
    width: 390,
    height: 844,
  },
  {
    name: "profile-edit-legacy-desktop-chromium.png",
    state: "legacy",
    project: "desktop-chromium",
    width: 1280,
    height: 800,
  },
  {
    name: "profile-edit-legacy-tablet-chromium.png",
    state: "legacy",
    project: "tablet-chromium",
    width: 768,
    height: 1024,
  },
  {
    name: "profile-edit-legacy-mobile-chromium.png",
    state: "legacy",
    project: "mobile-chromium",
    width: 390,
    height: 844,
  },
]

export function assertTask7EvidenceContract() {
  assertMode600(task7EvidencePath)
  assertMode700(path.dirname(task7EvidencePath))
  assertMode700(visualDir)
  assertMode700(path.dirname(receiptPath))
  const evidence = readJson(task7EvidencePath)
  assert.equal(evidence.schemaVersion, 1)
  assert.equal(evidence.rawOutputDirRetained, null)
  assert.equal(evidence.rawOutputCleanupStatus, "APPROVE")
  assert.equal(evidence.runErrorHash, null)
  assert.equal(evidence.supabaseTempCleanup?.verdict, "APPROVE")
  assert.equal(evidence.visual?.verdict, "APPROVE")
  assert.deepEqual(evidence.specs, ["tests/auth-ui-e2e/mypage-profile-edit.spec.ts"])
  assert.deepEqual(evidence.projects, ["desktop-chromium", "tablet-chromium", "mobile-chromium"])
  assert.equal(hashPayloadWithoutSelfHash(evidence), evidence.selfHash?.value)
  assert.match(readText(screenDocPath), /시각 증거: .*정확한 7개 PNG/u)
  const screenshots = readText(observationsPath)
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((observation) => observation.type === "screenshot")
    .map(({ project, receipt }) => ({ project, state: receipt.state, ...receipt }))
  assertVisualEvidenceMatrix({
    expectedPngCount: evidence.visual.expectedPngCount,
    observedPngCount: evidence.visual.observedPngCount,
    pngs: evidence.visual.pngs,
    screenshots,
    fileBinding: (name) => fileBinding(`${visualDir}/${name}`),
  })
  assertTask8SupersessionBinding(evidence)
  assertTask7TerminalReceiptBinding(evidence)
  assert.doesNotMatch(
    JSON.stringify({ evidence, screenshots }),
    /Bearer\s|authorization|access_token|refresh_token|password|@/iu,
  )
  return evidence
}

export function assertVisualEvidenceMatrix({
  expectedPngCount,
  observedPngCount,
  pngs,
  screenshots,
  fileBinding: bindingFor,
}) {
  assert.equal(expectedPngCount, expectedPngs.length)
  assert.equal(observedPngCount, expectedPngs.length)
  assertExactNames(pngs, "manifest PNGs")
  assertExactNames(screenshots, "screenshot observations")

  for (const expected of expectedPngs) {
    const png = pngs.find((entry) => entry.name === expected.name)
    const screenshot = screenshots.find((entry) => entry.name === expected.name)
    assert.ok(png)
    assert.ok(screenshot)
    assert.equal(png.width, expected.width)
    assert.equal(png.height, expected.height)
    assert.equal(screenshot.project, expected.project)
    assert.equal(screenshot.state, expected.state)
    assert.equal(screenshot.width, expected.width)
    assert.equal(screenshot.height, expected.height)
    assert.equal(screenshot.sha256, png.sha256)
    assert.match(png.sha256, /^[a-f0-9]{64}$/u)
    assert.deepEqual(bindingFor(expected.name), { mode: "600", sha256: png.sha256 })
    if (expected.state === "success") {
      assert.deepEqual(screenshot.successConfirmation, {
        inViewport: true,
        role: "status",
        state: "rendered",
        text: "프로필 정보를 저장했어요.",
        visible: true,
      })
    } else {
      assert.equal("successConfirmation" in screenshot, false)
    }
  }
}

export async function assertPackageProfileEditRunnerReceiptContract() {
  const command = readJson(packagePath).scripts?.["test:e2e:profile-edit"]
  assert.equal(typeof command, "string")

  const { binary, outputPath, runnerPath } = parseNodeRunnerCommand(command)
  assert.equal(binary, "node")
  assert.equal(outputPath, null)
  assert.equal(fileBinding(runnerPath).mode, "644")

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-profile-edit-docs-contract-"))
  const manifestPath = path.join(tempRoot, ".omo/evidence/mypage-profile-edit/run/summary.json")
  const supportDir = path.join(path.dirname(manifestPath), "support")
  const visualDir = path.join(path.dirname(manifestPath), "task-7-visual")
  const supportPath = path.join(supportDir, "support-summary.json")
  const visualPath = path.join(visualDir, "profile-edit-success-desktop-chromium.png")

  try {
    await mkdir(supportDir, { mode: 0o700, recursive: true })
    await mkdir(visualDir, { mode: 0o700, recursive: true })
    const manifestPayload = { schemaVersion: 1, verdict: "APPROVE" }
    const manifest = {
      ...manifestPayload,
      selfHash: {
        algorithm: "sha256",
        scope: "canonical JSON payload before selfHash insertion",
        value: sha256Text(JSON.stringify(manifestPayload)),
      },
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
    await writeFile(supportPath, '{"verdict":"APPROVE"}\n', { mode: 0o600 })
    await writeFile(visualPath, "png-binding\n", { mode: 0o600 })

    const writtenReceiptPath = await writeProfileEditTerminalReceipt({
      outputPath: manifestPath,
      visualDir,
    })
    assertMode600(writtenReceiptPath)
    const receipt = JSON.parse(await readFile(writtenReceiptPath, "utf8"))
    assert.equal(receipt.schemaVersion, 1)
    assert.equal(receipt.type, "task-7-terminal-closure-receipt")
    assert.equal(receipt.verdict, "APPROVE")
    assert.equal(receipt.manifest.mode, "600")
    assert.equal(receipt.manifest.sha256, fileBinding(manifestPath).sha256)
    assert.equal(receipt.manifest.selfHash, manifest.selfHash.value)
    assert.deepEqual(
      receipt.support.map((entry) => entry.name),
      ["support-summary.json"],
    )
    assert.deepEqual(
      receipt.visual.map((entry) => entry.name),
      ["profile-edit-success-desktop-chromium.png"],
    )
    assert.match(receipt.selfHash?.value, /^[a-f0-9]{64}$/u)
  } finally {
    await rm(tempRoot, { force: true, recursive: true })
  }
}

export function assertDeferredClaimsNotImplemented() {
  const deferredCapabilities = [
    /PASS|본인 인증/iu,
    /아바타|avatar|프로필 사진|이미지 업로드/iu,
    /계정 삭제|탈퇴/iu,
    /Hosted Supabase|호스티드 Supabase|provider|프로바이더/iu,
    /nullable|null clearing|null 클리어|초기화/iu,
  ]
  const implementedWords = /구현|완료|제공|연동|지원|implemented|available|enabled/iu
  const deferredWords = /제외|미구현|보류|deferred|not implemented|later|추후/iu

  for (const filePath of [screenDocPath, ...docsPaths]) {
    const profileEditLines = readText(filePath)
      .split(/\r?\n/u)
      .filter((line) => /mypage\/profile|프로필 수정|profile edit|profile-edit/iu.test(line))
    for (const line of profileEditLines) {
      if (!implementedWords.test(line) || deferredWords.test(line)) continue
      for (const capability of deferredCapabilities) {
        assert.doesNotMatch(line, capability, `${filePath} claims deferred profile capability`)
      }
    }
  }
}

function assertTask7TerminalReceiptBinding(evidence) {
  assertMode600(receiptPath)
  const receipt = readJson(receiptPath)
  assert.equal(receipt.schemaVersion, 1)
  assert.equal(receipt.type, "task-7-terminal-closure-receipt")
  assert.equal(receipt.verdict, "APPROVE")
  assert.equal(receipt.manifest.mode, "600")
  assert.equal(receipt.manifest.sha256, fileBinding(task7EvidencePath).sha256)
  assert.equal(receipt.manifest.selfHash, evidence.selfHash.value)
  assert.equal(hashPayloadWithoutSelfHash(receipt), receipt.selfHash?.value)
  assertExactNames(
    receipt.visual.filter((entry) => entry.name.endsWith(".png")),
    "terminal receipt PNGs",
  )
  assert.deepEqual(
    receipt.visual.map((entry) => entry.name).sort(),
    ["observations.jsonl", ...expectedPngs.map(({ name }) => name)].sort(),
  )
  assert.ok(receipt.support.some((entry) => entry.name === path.basename(supersessionPath)))
  for (const entry of [...receipt.support, ...receipt.visual]) {
    assert.equal(entry.mode, "600")
    assert.match(entry.sha256, /^[a-f0-9]{64}$/u)
  }
  for (const entry of receipt.visual) {
    assert.deepEqual(fileBinding(`${visualDir}/${entry.name}`), {
      mode: entry.mode,
      sha256: entry.sha256,
    })
  }
}

function assertTask8SupersessionBinding(evidence) {
  assertMode600(supersessionPath)
  const supersession = readJson(supersessionPath)
  assert.equal(supersession.schemaVersion, 1)
  assert.equal(supersession.type, "profile-edit-legacy-matrix-supersession-receipt")
  assert.equal(supersession.verdict, "APPROVE")
  assert.equal(hashPayloadWithoutSelfHash(supersession), supersession.selfHash?.value)
  assert.deepEqual(
    supersession.exactSevenPngMatrix.map(({ name }) => name).sort(),
    expectedPngs.map(({ name }) => name).sort(),
  )
  assert.deepEqual(
    supersession.preservedFourPngControls.map(({ name }) => name).sort(),
    expectedPngs
      .filter(({ state }) => state !== "legacy")
      .map(({ name }) => name)
      .sort(),
  )
  for (const control of supersession.preservedFourPngControls) {
    const manifestPng = evidence.visual.pngs.find((png) => png.name === control.name)
    assert.equal(control.sha256, manifestPng?.sha256)
  }
  assert.equal(supersession.publishedManifest.sha256, fileBinding(task7EvidencePath).sha256)
  assert.equal(supersession.publishedManifest.selfHash, evidence.selfHash.value)
  for (const source of supersession.sourceBindings) {
    assert.deepEqual(fileBinding(source.path), { mode: source.mode, sha256: source.sha256 })
  }
}

function assertExactNames(entries, label) {
  const names = entries.map((entry) => entry.name)
  assert.equal(
    new Set(names).size,
    expectedPngs.length,
    `${label} must not contain duplicate names`,
  )
  assert.deepEqual(names.sort(), expectedPngs.map(({ name }) => name).sort(), label)
}

function assertMode700(directory) {
  const mode = (statSync(directory).mode & 0o777).toString(8).padStart(3, "0")
  assert.equal(mode, "700")
}

function hashPayloadWithoutSelfHash(value) {
  const { selfHash: _selfHash, ...payload } = value
  return sha256Text(JSON.stringify(payload))
}

function parseNodeRunnerCommand(command) {
  const parts = command.trim().split(/\s+/u)
  assert.ok(parts.length >= 2)
  const [binary, runnerPath, outputPath, ...rest] = parts
  assert.deepEqual(rest, [])
  assert.equal(runnerPath.endsWith(".mjs"), true)
  return { binary, outputPath: outputPath ?? null, runnerPath }
}
