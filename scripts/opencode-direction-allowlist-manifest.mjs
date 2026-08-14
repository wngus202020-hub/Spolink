import { createHash } from "node:crypto"
import { lstat, readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"

export const SOURCE_DIRECTORIES = [
  "app",
  "components",
  "lib",
  "public",
  "scripts",
  "tests",
  "supabase/migrations",
  "supabase/tests",
  ".omo/drafts",
  ".omo/plans",
]
export const ROOT_IGNORED_FILES = new Set([".DS_Store", "tsconfig.tsbuildinfo"])
export const ROOT_IGNORED_SYMLINKS = new Set([".codegraph"])
export const EVIDENCE_PREFIX = ".omo/evidence/opencode-direction-alignment/"
export const ACTIVE_PLAN_PATH = ".omo/plans/opencode-direction-alignment.md"
export const PROTECTED_DIRECTORIES = [
  "app/api/payments",
  "app/api/reservations",
  "lib/payments",
  "lib/reservations",
  "supabase/migrations",
  "supabase/tests",
]
export const PROTECTED_FILES = ["lib/favorites/read-model.ts", "package.json", "pnpm-lock.yaml"]
export const ALLOWED_CHANGE_PATHS = [
  "AGENTS.md",
  "SPOLINK_API_명세서.md",
  "SPOLINK_디자인_시스템.md",
  "SPOLINK_화면_설계.md",
  "app/globals.css",
  "app/lessons/[lessonId]/page.tsx",
  "app/lessons/page.tsx",
  "app/page.tsx",
  "components/auth/reset-password-form.tsx",
  "components/auth/signup-form.tsx",
  "components/home/home-discovery-panel.tsx",
  "components/home/lesson-card-media.tsx",
  "components/home/lesson-card.tsx",
  "components/layout/public-header.tsx",
  "components/lessons/lesson-search-filter-content.tsx",
  "components/lessons/lesson-search-picker.tsx",
  "components/lessons/lesson-search-sheet.tsx",
  "components/lessons/lesson-search-summary.tsx",
  "lib/home-data-types.ts",
  "lib/home-data.ts",
  "lib/lesson-regions.ts",
  "lib/lesson-search.ts",
  "lib/lessons/display-lesson-mapper.ts",
  "lib/lessons/display-lessons.ts",
  "lib/lessons/public-lesson-api.ts",
  "lib/profile/route-handlers.ts",
  "package.json",
  "playwright.auth.config.ts",
  "pnpm-lock.yaml",
  "public/images/lesson-pilates.webp",
  "public/images/lesson-running.webp",
  "public/images/lesson-tennis.webp",
  "scripts/generate-lesson-regions.mjs",
  "scripts/opencode-direction-allowlist-manifest.mjs",
  "scripts/verify-opencode-direction-allowlist.mjs",
  "tests/auth-ui-e2e/auth-form-helpers.ts",
  "tests/auth-ui-e2e/auth-forms.spec.ts",
  "tests/auth-ui-e2e/direction-alignment-home.spec.ts",
  "tests/auth-ui-e2e/direction-alignment-matrix.mjs",
  "tests/auth-ui-e2e/direction-alignment-media.spec.ts",
  "tests/auth-ui-e2e/direction-alignment-runner-lifecycle.mjs",
  "tests/auth-ui-e2e/direction-alignment-search.spec.ts",
  "tests/auth-ui-e2e/direction-alignment-smoke.spec.ts",
  "tests/auth-ui-e2e/direction-alignment-visual-helpers.ts",
  "tests/auth-ui-e2e/run-direction-alignment.mjs",
  "tests/auth-ui-e2e/run-direction-regressions.mjs",
  "tests/documentation-alignment-contract.test.mjs",
  "tests/fixtures/regions/molit-legal-districts-20260630.csv",
  "tests/fixtures/regions/molit-legal-districts-20260630.sha256",
  "tests/home-direction-contract.test.mjs",
  "tests/lesson-media-contract.test.mjs",
  "tests/lesson-regions.test.mjs",
  "tests/lesson-search-picker-contract.test.mjs",
  "tests/lesson-search-ui-contract.test.mjs",
  "tests/lesson-search.test.mjs",
  "tests/profile-api/fixtures.mjs",
  "tests/profile-api/route-handlers-mutation.test.mjs",
  "tests/profile-api/route-handlers.test.mjs",
  "tests/supabase-e2e/cancellation-api.test.mjs",
  "tests/supabase-e2e/cancellation-concurrency/workers.mjs",
  "tests/supabase-e2e/cancellation-policy-runtime.mjs",
  "tests/supabase-e2e/task8/internal-qa.mjs",
]

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

export function isEvidencePath(path) {
  return path === EVIDENCE_PREFIX.slice(0, -1) || path.startsWith(EVIDENCE_PREFIX)
}

function toWorkspacePath(path) {
  return relative(process.cwd(), path).split("\\").join("/")
}

function canonicalContent(path, content) {
  if (path !== ACTIVE_PLAN_PATH) {
    return content
  }
  return content
    .toString("utf8")
    .replace(/^(- \[)x(\]) ((?:(?:[1-9]|1[0-4])\.|F[1-4]\.))/gm, "$1 $2 $3")
    .replace(
      /^- F4 Auth 회귀에서 확인된 ready 사용자 표시 누락을 복구하기 위해 사용자가 명시적으로 승인한 `components\/layout\/public-header\.tsx` 변경만 추가 허용한다\. 정확한 프로필 표시 이름을 노출하되 기존 `마이` 링크와 POST 로그아웃 계약은 보존한다\.$\n/m,
      "",
    )
    .replace(
      /^- F2 고정밀 재검토에서 확인된 250 pure-LOC 초과 5개 모듈을 행동 보존형으로 분리하도록 사용자가 명시적으로 승인한 `scripts\/opencode-direction-allowlist-manifest\.mjs`, `tests\/auth-ui-e2e\/direction-alignment-matrix\.mjs`, `tests\/auth-ui-e2e\/direction-alignment-runner-lifecycle\.mjs`, `tests\/auth-ui-e2e\/direction-alignment-visual-helpers\.ts`, `tests\/profile-api\/route-handlers-mutation\.test\.mjs`만 추가 허용한다\. 기존 CLI\/spec 경로와 관찰 가능한 테스트 계약은 바꾸지 않는다\.$\n/m,
      "",
    )
    .replace(
      /^- 사용자가 명시적으로 승인한 의존성 remediation 범위는 `package\.json`과 `pnpm-lock\.yaml`의 Next `16\.2\.11`, pnpm overrides `sharp` `0\.35\.0` 및 `postcss` `8\.5\.18`뿐이다\. 이 pre-edit scope transition은 `pnpm-lock\.yaml`을 정확한 62번째 허용 source path로만 추가하며, 다음 remediation 전까지 package\/lock dependency bytes와 그 밖의 범위는 변경하지 않는다\.$\n/m,
      "",
    )
    .replace(/^\| F4 recovery \| `components\/layout\/public-header\.tsx` \| none \|\n/m, "")
    .replace(
      /^\| 1 \| none \| `scripts\/verify-opencode-direction-allowlist\.mjs`, `scripts\/opencode-direction-allowlist-manifest\.mjs` \|\n/m,
      "| 1 | none | `scripts/verify-opencode-direction-allowlist.mjs` |\n",
    )
    .replace(
      /^\| 4 \| `lib\/profile\/route-handlers\.ts`, `tests\/profile-api\/fixtures\.mjs`, `tests\/profile-api\/route-handlers\.test\.mjs`, `SPOLINK_API_명세서\.md` \| `tests\/profile-api\/route-handlers-mutation\.test\.mjs` \|\n/m,
      "| 4 | `lib/profile/route-handlers.ts`, `tests/profile-api/fixtures.mjs`, `tests/profile-api/route-handlers.test.mjs`, `SPOLINK_API_명세서.md` | none |\n",
    )
    .replace(
      /^\| 9 \| `playwright\.auth\.config\.ts`, `package\.json` \| `tests\/auth-ui-e2e\/direction-alignment-smoke\.spec\.ts`, `tests\/auth-ui-e2e\/run-direction-alignment\.mjs`, `tests\/auth-ui-e2e\/run-direction-regressions\.mjs`, `tests\/auth-ui-e2e\/direction-alignment-matrix\.mjs`, `tests\/auth-ui-e2e\/direction-alignment-runner-lifecycle\.mjs`, `tests\/auth-ui-e2e\/direction-alignment-visual-helpers\.ts` \|\n/m,
      "| 9 | `playwright.auth.config.ts`, `package.json` | `tests/auth-ui-e2e/direction-alignment-smoke.spec.ts`, `tests/auth-ui-e2e/run-direction-alignment.mjs`, `tests/auth-ui-e2e/run-direction-regressions.mjs` |\n",
    )
    .replace(
      /^\| 9 \| `package\.json`, `playwright\.auth\.config\.ts`, `pnpm-lock\.yaml` \| `tests\/auth-ui-e2e\/direction-alignment-smoke\.spec\.ts`, `tests\/auth-ui-e2e\/run-direction-alignment\.mjs`, `tests\/auth-ui-e2e\/run-direction-regressions\.mjs`, `tests\/auth-ui-e2e\/direction-alignment-matrix\.mjs`, `tests\/auth-ui-e2e\/direction-alignment-runner-lifecycle\.mjs`, `tests\/auth-ui-e2e\/direction-alignment-visual-helpers\.ts` \|\n/m,
      "| 9 | `playwright.auth.config.ts`, `package.json` | `tests/auth-ui-e2e/direction-alignment-smoke.spec.ts`, `tests/auth-ui-e2e/run-direction-alignment.mjs`, `tests/auth-ui-e2e/run-direction-regressions.mjs` |\n",
    )
}

export async function regularFilesBelow(directory) {
  const directoryStat = await lstat(directory)
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error(`source directory must be a real directory: ${directory}`)
  }
  const files = []
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    const fullPath = join(directory, entry.name)
    const workspacePath = toWorkspacePath(fullPath)
    if (isEvidencePath(workspacePath)) {
      continue
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`symbolic links are not allowed in the source universe: ${workspacePath}`)
    }
    if (entry.isDirectory()) {
      files.push(...(await regularFilesBelow(fullPath)))
    } else if (entry.isFile()) {
      files.push(workspacePath)
    }
  }
  return files
}

export async function sourcePaths() {
  const paths = []
  for (const directory of SOURCE_DIRECTORIES) {
    paths.push(...(await regularFilesBelow(directory)))
  }
  const rootEntries = await readdir(".", { withFileTypes: true })
  rootEntries.sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of rootEntries) {
    if (ROOT_IGNORED_FILES.has(entry.name)) {
      continue
    }
    if (entry.isSymbolicLink()) {
      if (!ROOT_IGNORED_SYMLINKS.has(entry.name)) {
        throw new Error(`symbolic links are not allowed in the source universe: ${entry.name}`)
      }
    } else if (entry.isFile()) {
      paths.push(entry.name)
    }
  }
  const configStat = await lstat("supabase/config.toml")
  if (configStat.isSymbolicLink() || !configStat.isFile()) {
    throw new Error("supabase/config.toml must be a regular file")
  }
  paths.push("supabase/config.toml")
  return [...new Set(paths)].sort()
}

export async function entryFor(path) {
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`source path must be a regular file: ${path}`)
  }
  const contentSha256 = sha256(canonicalContent(path, await readFile(path)))
  const type = "file"
  return {
    path,
    type,
    sha256: contentSha256,
    recordSha256: sha256(`${path}\0${type}\0${contentSha256}`),
  }
}

export async function sourceEntries() {
  return Promise.all((await sourcePaths()).map(entryFor))
}

export async function protectedPaths() {
  const paths = []
  for (const directory of PROTECTED_DIRECTORIES) {
    paths.push(...(await regularFilesBelow(directory)))
  }
  for (const path of PROTECTED_FILES) {
    const stat = await lstat(path)
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`protected path must be a regular file: ${path}`)
    }
    paths.push(path)
  }
  return [...new Set(paths)].sort()
}

export function assertSortedUnique(values, label) {
  if (values.length === 0) {
    throw new Error(`${label} must not be empty`)
  }
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] >= values[index]) {
      throw new Error(`${label} must be sorted and duplicate-free`)
    }
  }
}
