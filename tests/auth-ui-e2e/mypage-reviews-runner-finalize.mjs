import { readFile, rm } from "node:fs/promises"
import path from "node:path"
import {
  allCountersAreZero,
  assertNoSensitiveEvidence,
  projects,
  sha256,
  sourceManifest,
  writeMode600Json,
} from "./mypage-reviews-evidence.mjs"
import {
  removePublishedVisuals,
  validateAndPublishVisualBundle,
} from "./mypage-reviews-visual-evidence.mjs"

export async function finalizeMypageReviewsRun(input) {
  const [lifecycle, currentSources] = await Promise.all([
    readJsonOrReject(input.paths.lifecycleCleanup),
    sourceManifest(),
  ])
  const sourcesUnchanged = JSON.stringify(input.initialSources) === JSON.stringify(currentSources)
  const scenariosApprove =
    input.receipts.length === projects.length &&
    input.receipts.every((receipt) =>
      input.expectedScenarios.every((scenario) => receipt.scenarios.includes(scenario)),
    )
  const cleanupApprove = allCountersAreZero(input.receipts)
  const grantRestored =
    input.receipts.length === projects.length &&
    input.receipts.every((receipt) => receipt.grantRestored === true)
  const lockReleased =
    input.receipts.find((receipt) => receipt.project === "mobile-chromium")?.lockRelease ===
    "released"
  const lifecycleApprove =
    lifecycle.verdict === "APPROVE" &&
    lifecycle.stoppedAsserted === true &&
    lifecycle.cleanup?.config === "external-removed"
  const observations = input.receipts.flatMap((receipt) => receipt.visuals ?? [])
  let visualBundle = null
  let visualErrorHash = null
  if (!input.injectionRequested && input.run?.exitCode === 0 && sourcesUnchanged) {
    try {
      visualBundle = await validateAndPublishVisualBundle({
        observations,
        parentSha: input.parentSha,
        publishDir: input.paths.screenshots,
        sourceManifest: currentSources,
        stagingDir: path.join(input.rawOutputDir, "visuals"),
      })
    } catch (error) {
      visualErrorHash = sha256(error instanceof Error ? error.message : String(error))
    }
  } else {
    await removePublishedVisuals(input.paths.screenshots)
  }
  const visualApprove = visualBundle?.images.length === input.exactVisualImageCount
  const functionalApprove =
    !input.injectionRequested &&
    input.run?.exitCode === 0 &&
    scenariosApprove &&
    cleanupApprove &&
    grantRestored &&
    lockReleased &&
    lifecycleApprove &&
    input.lifecycleErrorHash === null &&
    sourcesUnchanged &&
    visualApprove &&
    visualErrorHash === null
  const verdict = functionalApprove ? "APPROVE" : "REJECT"
  const cleanup = {
    exactCountersAllZero: cleanupApprove,
    fixtures: input.receipts.map((receipt) => ({
      cleanupCounters: receipt.cleanup.cleanupCounters,
      project: receipt.project,
      verdict: receipt.cleanup.verdict,
    })),
    grantRestored,
    lifecycle,
    lockReleased,
    publicationRemovedOnFailure: verdict === "APPROVE" || visualBundle === null,
    schemaVersion: 1,
    verdict:
      cleanupApprove && grantRestored && lockReleased && lifecycleApprove ? "APPROVE" : "REJECT",
  }
  assertNoSensitiveEvidence(cleanup)
  await writeMode600Json(input.paths.cleanup, cleanup)

  let manifestHash = null
  if (visualBundle) {
    const manifest = {
      images: visualBundle.images.map(({ height, name, sha256: imageSha, width }) => ({
        height,
        name,
        sha256: imageSha,
        width,
      })),
      parentSha: input.parentSha,
      schemaVersion: 1,
      sources: currentSources,
    }
    await writeMode600Json(input.paths.manifest, manifest)
    manifestHash = sha256(await readFile(input.paths.manifest))
  } else {
    await rm(input.paths.manifest, { force: true })
  }
  const visualSummary = visualBundle
    ? {
        ...visualBundle,
        canonicalManifestSha256: manifestHash,
        generatedAt: new Date().toISOString(),
      }
    : {
        canonicalManifestSha256: null,
        errorHash: visualErrorHash,
        generatedAt: new Date().toISOString(),
        images: [],
        parentSha: input.parentSha,
        schemaVersion: 1,
        sourceManifest: currentSources,
        verdict: "REJECT",
      }
  assertNoSensitiveEvidence(visualSummary)
  await writeMode600Json(input.paths.visual, visualSummary)
  const injectionObserved = input.receipts.some((receipt) => receipt.injectedFailure === true)
  const summary = {
    cleanup,
    exitCode: input.run?.exitCode ?? null,
    failureInjection: {
      observed: injectionObserved,
      requested: input.injectionRequested,
      restorationProved: injectionObserved && cleanup.verdict === "APPROVE",
    },
    generatedAt: new Date().toISOString(),
    lifecycleErrorHash: input.lifecycleErrorHash,
    parentSha: input.parentSha,
    projects,
    resultHash: input.run?.resultHash ?? null,
    scenarioResults: input.receipts.map((receipt) => ({
      project: receipt.project,
      scenarios: receipt.scenarios.map((scenario) => ({ scenario, verdict: "APPROVE" })),
    })),
    schemaVersion: 3,
    signal: input.run?.signal ?? null,
    sourceManifest: currentSources,
    sourcesUnchanged,
    specs: [input.spec],
    verdict,
    visual: {
      canonicalManifestSha256: manifestHash,
      imageCount: visualBundle?.images.length ?? 0,
      visualSummary: "visual-summary.json",
    },
  }
  assertNoSensitiveEvidence(summary)
  await writeMode600Json(input.outputPath, summary)
  return { verdict }
}

async function readJsonOrReject(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"))
  } catch (error) {
    return {
      errorHash: sha256(error instanceof Error ? error.message : String(error)),
      verdict: "REJECT",
    }
  }
}
