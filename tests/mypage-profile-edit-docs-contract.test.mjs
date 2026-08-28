import assert from "node:assert/strict"
import { test } from "node:test"

import {
  assertDeferredClaimsNotImplemented,
  assertPackageProfileEditRunnerReceiptContract,
  assertTask7EvidenceContract,
  assertVisualEvidenceMatrix,
} from "./mypage-profile-edit-docs-assertions.mjs"

test("package command resolves to a profile edit runner with validated terminal receipt schema", async () => {
  await assertPackageProfileEditRunnerReceiptContract()
})

test("Todo7 evidence exposes the exact seven-image profile edit matrix", () => {
  const evidence = assertTask7EvidenceContract()

  assert.equal(evidence.verdict, "APPROVE")
  assert.equal(evidence.exitCode, 0)
  assert.equal(evidence.signal, null)
  assert.equal(evidence.playwrightReport.observedCount, 9)
  assert.equal(evidence.playwrightReport.failedCount, 0)
  assert.equal(evidence.playwrightReport.missingCount, 0)
  assert.equal(evidence.playwrightReport.skippedCount, 0)
  assert.equal(evidence.visual.expectedPngCount, 7)
  assert.equal(evidence.visual.observedPngCount, 7)
})

test("profile edit evidence matrix rejects unknown, missing, stale, duplicate, and weak-mode fixtures", () => {
  const evidence = assertTask7EvidenceContract()
  const fixture = createVisualFixture(evidence)

  assert.doesNotThrow(() => assertVisualEvidenceMatrix(fixture))

  assert.throws(() =>
    assertVisualEvidenceMatrix({
      ...fixture,
      observedPngCount: 8,
      pngs: [...fixture.pngs, { ...fixture.pngs[0], name: "profile-edit-unknown-chromium.png" }],
      screenshots: [
        ...fixture.screenshots,
        {
          ...fixture.screenshots[0],
          name: "profile-edit-unknown-chromium.png",
        },
      ],
    }),
  )

  assert.throws(() =>
    assertVisualEvidenceMatrix({
      ...fixture,
      observedPngCount: 6,
      pngs: fixture.pngs.filter((png) => png.name !== "profile-edit-legacy-mobile-chromium.png"),
      screenshots: fixture.screenshots.filter(
        (screenshot) => screenshot.name !== "profile-edit-legacy-mobile-chromium.png",
      ),
    }),
  )

  assert.throws(() =>
    assertVisualEvidenceMatrix({
      ...fixture,
      pngs: fixture.pngs.map((png) =>
        png.name === "profile-edit-success-desktop-chromium.png"
          ? { ...png, sha256: "0".repeat(64) }
          : png,
      ),
    }),
  )

  assert.throws(() =>
    assertVisualEvidenceMatrix({
      ...fixture,
      fileBinding: (name) => ({
        ...fixture.fileBinding(name),
        mode: name === "profile-edit-success-desktop-chromium.png" ? "644" : "600",
      }),
    }),
  )

  assert.throws(() =>
    assertVisualEvidenceMatrix({
      ...fixture,
      observedPngCount: 8,
      pngs: [...fixture.pngs, fixture.pngs[0]],
      screenshots: [...fixture.screenshots, fixture.screenshots[0]],
    }),
  )
})

test("profile edit evidence matrix rejects a success capture recorded after reload", () => {
  const fixture = createSyntheticVisualFixture()
  const postReloadFixture = {
    ...fixture,
    screenshots: fixture.screenshots.map((screenshot) =>
      screenshot.state === "success"
        ? {
            ...screenshot,
            successConfirmation: {
              inViewport: false,
              role: "status",
              state: "after-reload",
              text: "",
              visible: false,
            },
          }
        : screenshot,
    ),
  }

  assert.throws(() => assertVisualEvidenceMatrix(postReloadFixture))
})

test("owned docs do not claim deferred profile edit capabilities are implemented", () => {
  assertDeferredClaimsNotImplemented()
})

function createVisualFixture(evidence) {
  const pngs = evidence.visual.pngs.map((png) => ({ ...png }))
  const screenshots = pngs.map((png) => ({
    ...png,
    project: projectForName(png.name),
    state: stateForName(png.name),
    ...(stateForName(png.name) === "success"
      ? {
          successConfirmation: {
            inViewport: true,
            role: "status",
            state: "rendered",
            text: "프로필 정보를 저장했어요.",
            visible: true,
          },
        }
      : {}),
  }))
  const bindings = new Map(pngs.map((png) => [png.name, { mode: "600", sha256: png.sha256 }]))

  return {
    expectedPngCount: 7,
    observedPngCount: 7,
    pngs,
    screenshots,
    fileBinding: (name) => bindings.get(name),
  }
}

function projectForName(name) {
  if (name.endsWith("desktop-chromium.png")) return "desktop-chromium"
  if (name.endsWith("tablet-chromium.png")) return "tablet-chromium"
  return "mobile-chromium"
}

function stateForName(name) {
  if (name.includes("-legacy-")) return "legacy"
  if (name.includes("-validation-")) return "validation"
  return "success"
}

function createSyntheticVisualFixture() {
  const pngs = [
    ["profile-edit-success-desktop-chromium.png", "success", "desktop-chromium", 1280, 800],
    ["profile-edit-success-tablet-chromium.png", "success", "tablet-chromium", 768, 1024],
    ["profile-edit-success-mobile-chromium.png", "success", "mobile-chromium", 390, 844],
    ["profile-edit-validation-mobile-chromium.png", "validation", "mobile-chromium", 390, 844],
    ["profile-edit-legacy-desktop-chromium.png", "legacy", "desktop-chromium", 1280, 800],
    ["profile-edit-legacy-tablet-chromium.png", "legacy", "tablet-chromium", 768, 1024],
    ["profile-edit-legacy-mobile-chromium.png", "legacy", "mobile-chromium", 390, 844],
  ].map(([name, state, project, width, height], index) => ({
    height,
    name,
    project,
    sha256: String(index).padStart(64, "0"),
    state,
    width,
  }))
  const screenshots = pngs.map((png) => ({
    ...png,
    ...(png.state === "success"
      ? {
          successConfirmation: {
            inViewport: true,
            role: "status",
            state: "rendered",
            text: "프로필 정보를 저장했어요.",
            visible: true,
          },
        }
      : {}),
  }))
  const bindings = new Map(pngs.map(({ name, sha256 }) => [name, { mode: "600", sha256 }]))

  return {
    expectedPngCount: 7,
    observedPngCount: 7,
    pngs,
    screenshots,
    fileBinding: (name) => bindings.get(name),
  }
}
