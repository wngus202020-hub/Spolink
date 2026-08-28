import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

const required10cFiles = [
  "tests/auth-ui-e2e/learner-reservations-browser-diagnostics.test.mjs",
  "tests/auth-ui-e2e/learner-reservations-browser-diagnostics.ts",
  "tests/auth-ui-e2e/learner-reservations-calendar-assertions.ts",
  "tests/auth-ui-e2e/learner-reservations-completion-assertions.ts",
  "tests/auth-ui-e2e/learner-reservations-completion-recovery.ts",
  "tests/auth-ui-e2e/learner-reservations-helper-behavior.test.mjs",
  "tests/auth-ui-e2e/learner-reservations-request-guards.ts",
  "tests/auth-ui-e2e/learner-reservations-route-assertions.ts",
  "tests/auth-ui-e2e/learner-reservations-scenario-contract.ts",
  "tests/auth-ui-e2e/learner-reservations-scenario.ts",
  "tests/auth-ui-e2e/learner-reservations-source-files.mjs",
  "tests/auth-ui-e2e/learner-reservations-visual-assertions.ts",
  "tests/auth-ui-e2e/learner-reservations.spec.ts",
]

export const learnerReservationSourceFiles = [
  "app/globals.css",
  "app/mypage/reservations/[reservationId]/page.tsx",
  "app/reservations/[reservationId]/complete/page.tsx",
  "components/reservations/reservation-completion-view.tsx",
  "components/ui/button.tsx",
  "lib/reservations/completion-page-data.ts",
  "lib/reservations/read-model.ts",
  "playwright.auth.config.ts",
  ...required10cFiles,
  "tests/auth-ui-e2e/learner-reservations-evidence-bundle.mjs",
  "tests/auth-ui-e2e/learner-reservations-evidence-paths.mjs",
  "tests/auth-ui-e2e/learner-reservations-evidence-topology.mjs",
  "tests/auth-ui-e2e/learner-reservations-evidence-validation.mjs",
  "tests/auth-ui-e2e/learner-reservations-evidence.mjs",
  "tests/auth-ui-e2e/learner-reservations-fixtures.ts",
  "tests/auth-ui-e2e/learner-reservations-page-helpers.ts",
  "tests/auth-ui-e2e/run-learner-reservations.mjs",
  "tests/learner-reservations-e2e-contract.test.mjs",
  "tests/learner-reservations-evidence-publication-child.mjs",
  "tests/learner-reservations-evidence-publication-helpers.mjs",
  "tests/learner-reservations-evidence-publication.test.mjs",
  "tests/learner-reservations-evidence-security.test.mjs",
  "tests/reservation-completion-page-contract.test.mjs",
].sort()

export async function collectLearnerReservationSourceHashes(
  sourceFiles = learnerReservationSourceFiles,
) {
  const missing = required10cFiles.filter((filePath) => !sourceFiles.includes(filePath))
  if (missing.length > 0) {
    throw new Error(`Missing learner reservation 10C source files: ${missing.join(", ")}`)
  }
  if (new Set(sourceFiles).size !== sourceFiles.length) {
    throw new Error("Duplicate learner reservation source file")
  }
  const sorted = [...sourceFiles].sort()
  if (!sourceFiles.every((filePath, index) => filePath === sorted[index])) {
    throw new Error("Learner reservation source files must be sorted")
  }
  return Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (filePath) => [
        filePath,
        createHash("sha256")
          .update(await readFile(filePath))
          .digest("hex"),
      ]),
    ),
  )
}
