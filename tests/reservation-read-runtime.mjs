import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = fileURLToPath(new URL("..", import.meta.url))
const workspace = mkdtempSync(path.join(tmpdir(), "spolink-reservation-read-"))
const outputDirectory = path.join(workspace, "dist")
const configPath = path.join(workspace, "tsconfig.json")

writeFileSync(
  configPath,
  JSON.stringify({
    compilerOptions: {
      baseUrl: projectRoot,
      esModuleInterop: true,
      module: "CommonJS",
      moduleResolution: "Node",
      noEmit: false,
      outDir: outputDirectory,
      paths: { "@/*": [path.join(projectRoot, "*")] },
      rootDir: projectRoot,
      skipLibCheck: true,
      target: "ES2022",
    },
    files: [
      path.join(projectRoot, "lib/reservations/read-model.ts"),
      path.join(projectRoot, "lib/reservations/completion-page-data.ts"),
    ],
  }),
  { mode: 0o600 },
)
execFileSync(path.join(projectRoot, "node_modules/.bin/tsc"), ["--project", configPath], {
  cwd: projectRoot,
  stdio: "inherit",
})

const require = createRequire(import.meta.url)
const readModel = require(path.join(outputDirectory, "lib/reservations/read-model.js"))
const completionData = require(
  path.join(outputDirectory, "lib/reservations/completion-page-data.js"),
)

process.once("exit", () => rmSync(workspace, { force: true, recursive: true }))

export const {
  RESERVATION_FILTERS,
  RESERVATIONS_PER_PAGE,
  canContinueReservationPayment,
  getReservationStatusPresentation,
  normalizeReservationFilter,
  normalizeReservationPage,
  readReservationDetailData,
  readReservationListData,
  reservationStatusesForFilter,
} = readModel

export const { classifyReservationCompletionState, readReservationCompletionPageData } =
  completionData
