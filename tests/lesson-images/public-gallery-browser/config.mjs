import { createHash, randomUUID } from "node:crypto"
import path from "node:path"

import { CLEANUP_TIMEOUT_MS, RUN_TIMEOUT_MS } from "../public-gallery-browser-qa-runtime.mjs"

export const PUBLIC_VIEWPORTS = [
  { height: 800, name: "desktop", width: 1280 },
  { height: 1024, name: "tablet", width: 768 },
  { height: 844, name: "mobile", width: 390 },
  { height: 844, name: "narrow", width: 320 },
]

export const GALLERY_STATES = {
  broken: { mediaKind: "fallback", thumbnails: 0, title: "공개 갤러리 원격 실패 레슨" },
  five: { mediaKind: "image", thumbnails: 5, title: "공개 갤러리 다섯 장 레슨" },
  one: { mediaKind: "image", thumbnails: 0, title: "공개 갤러리 한 장 레슨" },
  zero: { mediaKind: "fallback", thumbnails: 0, title: "공개 갤러리 이미지 없음 레슨" },
}

export function createRunConfig(env = process.env) {
  const runId = randomUUID()
  const evidenceDir = path.resolve(
    env.PUBLIC_GALLERY_EVIDENCE_DIR ??
      ".omo/evidence/lesson-image-upload/task-8/remediation-round-2",
  )
  return {
    cleanupTimeoutMs: readBoundedTimeout(env.PUBLIC_GALLERY_CLEANUP_TIMEOUT_MS, CLEANUP_TIMEOUT_MS),
    evidenceDir,
    repoRoot: process.cwd(),
    runId,
    runIdHash: createHash("sha256").update(runId).digest("hex").slice(0, 16),
    runTimeoutMs: readBoundedTimeout(env.PUBLIC_GALLERY_RUN_TIMEOUT_MS, RUN_TIMEOUT_MS),
    stagingDir: path.join(evidenceDir, `.staging-${runId}`),
  }
}

export function buildPublishedArtifactNames() {
  const matrix = PUBLIC_VIEWPORTS.flatMap((viewport) => [
    ...Object.keys(GALLERY_STATES).map((state) => `public-gallery-${state}-${viewport.name}.png`),
    `public-gallery-one-sport-badge-${viewport.name}.png`,
    `public-gallery-one-badge-dom-${viewport.name}.json`,
  ])
  return [...matrix, "public-gallery-selected-image-3.png", "public-gallery-trace.zip"]
}

function readBoundedTimeout(raw, maximum) {
  const value = Number(raw ?? maximum)
  return Number.isInteger(value) && value >= 1_000 && value <= maximum ? value : maximum
}
