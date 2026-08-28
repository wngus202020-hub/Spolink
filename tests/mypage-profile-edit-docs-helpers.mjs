import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, statSync } from "node:fs"

export const screenDocPath = "SPOLINK_화면_설계.md"
export const packagePath = "package.json"
export const task7EvidencePath = ".omo/evidence/mypage-profile-edit/task-7-mypage-profile-edit.json"

export const docsPaths = [
  "AGENTS.md",
  "app/AGENTS.md",
  "components/AGENTS.md",
  "lib/AGENTS.md",
  "tests/AGENTS.md",
  "tests/auth-ui-e2e/AGENTS.md",
]

export function readText(filePath) {
  return readFileSync(filePath, "utf8")
}

export function readJson(filePath) {
  return JSON.parse(readText(filePath))
}

export function fileBinding(filePath) {
  const stat = statSync(filePath)
  return {
    mode: (stat.mode & 0o777).toString(8).padStart(3, "0"),
    sha256: createHash("sha256").update(readFileSync(filePath)).digest("hex"),
  }
}

export function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex")
}

export function assertMode600(filePath) {
  const stat = statSync(filePath)
  assert.equal((stat.mode & 0o777).toString(8).padStart(3, "0"), "600")
  assert.ok(stat.size > 0, `${filePath} must be nonempty`)
}
