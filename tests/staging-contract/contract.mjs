import { randomUUID } from "node:crypto"
import { lstat, mkdir, open, rename, writeFile } from "node:fs/promises"
import path from "node:path"

const redacted = "<redacted>"
const allowedEvidenceRoots = [
  path.resolve(".omo/evidence/staging"),
  path.resolve(".omo/evidence/staging-contract"),
]
const gate0Fields = Object.freeze([
  "githubPrivateRepository",
  "supabaseStagingProject",
  "vercelStagingTopology",
  "smtpMailbox",
  "cleanupAuthority",
  "stableHttpsOrigin",
  "resourceSeparation",
])
const gate0Statuses = Object.freeze(["BLOCKED", "VERIFIED", "REJECTED"])

const sensitiveKeyPattern =
  /(?:authorization|cookie|email|key|origin|password|project(?:_?id|_?ref|_?url)?|secret|token|url|uuid)/i
const jwtPattern = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
const authorizationPattern = /\bauthorization\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\r\n,;]+)/gi
const cookiePattern = /\b(?:cookie|set-cookie)\s*:\s*[^\r\n]+/gi
const supabaseKeyPattern = /\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+\b/g
const legacyKeyPattern = /\beyJ[A-Za-z0-9_-]{20,}\b/g
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi
const hostedUrlPattern = /\bhttps?:\/\/[^\s"'<>]+/gi
const projectRefAssignmentPattern =
  /\b(?:project[_ -]?ref|SUPABASE_PROJECT_ID)\s*[:=]\s*[A-Za-z0-9_-]+/gi
const credentialAssignmentPattern =
  /\b(?:password|secret|token|api[_ -]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi

export const fixtureNames = Object.freeze([
  "jwt",
  "cookie",
  "key",
  "email",
  "uuid",
  "project-ref",
  "url",
])

export function redactForEvidence(value, key = "") {
  if (
    isSensitiveKey(key) &&
    value !== null &&
    typeof value !== "boolean" &&
    typeof value !== "number"
  ) {
    return redacted
  }
  if (typeof value === "string") {
    return redactString(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactForEvidence(item))
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactForEvidence(entryValue, entryKey),
      ]),
    )
  }
  return value
}

export function containsSensitiveMaterial(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value)
  return [
    jwtPattern,
    authorizationPattern,
    cookiePattern,
    supabaseKeyPattern,
    legacyKeyPattern,
    emailPattern,
    uuidPattern,
    hostedUrlPattern,
    projectRefAssignmentPattern,
    credentialAssignmentPattern,
  ].some((pattern) => resetAndTest(pattern, serialized))
}

export async function writeSafeEvidence(outputPath, evidence) {
  const target = await resolveSafeEvidencePath(outputPath)
  const sanitized = redactForEvidence(evidence)
  if (containsSensitiveMaterial(sanitized)) {
    throw new Error("Evidence contains sensitive material after redaction")
  }

  await assertNoSymlinkComponents(path.dirname(target))
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  await assertNoSymlinkComponents(path.dirname(target))
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  )
  await writeFile(temporary, `${JSON.stringify(sanitized, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, target)
  const handle = await open(target, "r+")
  try {
    await handle.chmod(0o600)
  } finally {
    await handle.close()
  }
  return sanitized
}

export function validateStagingContract(contract) {
  const reasons = []
  if (!nonEmpty(contract.SUPABASE_PROJECT_ID)) reasons.push("missing-project-id")
  if (!isHttpsUrl(contract.expectedStagingOrigin)) reasons.push("non-https-origin")
  if (contract.originCategory !== "staging") reasons.push("production-origin-category")
  if (contract.projectCategory !== "staging") reasons.push("production-project-category")
  if (contract.vercelEnvironment !== "staging") reasons.push("unknown-vercel-environment")
  if (!projectUrlMatches(contract.SUPABASE_PROJECT_ID, contract.expectedProjectUrl)) {
    reasons.push("project-url-mismatch")
  }
  if (
    nonEmpty(contract.productionProjectId) &&
    contract.productionProjectId === contract.SUPABASE_PROJECT_ID
  ) {
    reasons.push("production-project-reuse")
  }

  return {
    schemaVersion: 1,
    verdict: reasons.length === 0 ? "APPROVE" : "REJECT",
    providerCommandsStarted: 0,
    reasons,
    expectedEnvPresence: {
      SUPABASE_PROJECT_ID: nonEmpty(contract.SUPABASE_PROJECT_ID),
      expectedProjectUrl: nonEmpty(contract.expectedProjectUrl),
      expectedStagingOrigin: nonEmpty(contract.expectedStagingOrigin),
    },
  }
}

export function classifyCommand(command) {
  const normalized = String(command).trim().toLowerCase()
  const forbidden = [
    [/\bsupabase\s+db\s+reset\b/, "linked-database-reset"],
    [/\bsupabase\s+migration\s+down\b/, "migration-rollback"],
    [/\bsupabase\s+db\s+push\b.*\binclude-seed\b/, "seeded-migration-push"],
    [/\brm\s+-rf\b/, "recursive-fixture-removal"],
    [/supabase\/config\.toml/, "local-config-mutation"],
    [/\b(?:gh|vercel)\b/, "provider-cli"],
    [/\bsupabase\s+(?:link|db\s+push)\b/, "provider-mutation"],
  ]
  const match = forbidden.find(([pattern]) => pattern.test(normalized))
  if (match) {
    return {
      schemaVersion: 1,
      verdict: "REJECT",
      category: match[1],
      providerCommandsStarted: 0,
    }
  }
  return {
    schemaVersion: 1,
    verdict: "REJECT",
    category: "command-not-allow-listed",
    providerCommandsStarted: 0,
  }
}

export function approvedCommandPlan(contract) {
  const validation = validateStagingContract(contract)
  if (validation.verdict !== "APPROVE") return validation
  return {
    schemaVersion: 1,
    case: "valid-contract",
    verdict: "APPROVE",
    providerCommandsStarted: 0,
    commandResults: [
      { category: "contract-dry-run", exitCode: 0, execution: "offline-only" },
      { category: "resource-list", exitCode: null, execution: "requires-owner-approval" },
      { category: "staging-smoke", exitCode: null, execution: "requires-contract-approval" },
    ],
    expectedEnvPresence: validation.expectedEnvPresence,
    allowedCommandPlan: [
      { category: "contract-dry-run", execution: "offline-only" },
      { category: "resource-list", execution: "read-only-after-owner-approval" },
      { category: "staging-smoke", execution: "after-contract-approval" },
    ],
    migrationPush: { category: "migration-push", requiresApprovedHash: true },
    abortConditions: {
      invalidContractStartsProviderCommand: false,
      migrationPushWithoutApprovedHash: false,
      destructiveCommandAllowed: false,
    },
    cleanup: { required: false, reason: "offline contract test writes evidence only" },
    redactionScan: { rawPatternCount: 0, verdict: "APPROVE" },
  }
}

export function buildGate0Checklist(resourceState = {}) {
  const checks = gate0Fields.map((name) => gate0Check(name, resourceState[name]))
  const rejected = checks.some((check) => check.status === "REJECTED")
  const approved = checks.every((check) => check.status === "VERIFIED")
  return {
    schemaVersion: 1,
    gate: 0,
    environmentMatrix: {
      local: "loopback-only",
      staging: "provider-owner-approved-resources-only",
      production: "excluded-from-this-milestone",
    },
    verdict: rejected ? "REJECT" : approved ? "APPROVE" : "BLOCKED",
    providerCommandsStarted: 0,
    checks,
    identifiersRecorded: false,
    cleanup: { required: false, reason: "Gate 0 checklist is read-only" },
    redactionScan: { rawPatternCount: 0, verdict: "APPROVE" },
  }
}

export function validateGate0ResourceInput(input) {
  if (!isPlainObject(input)) throw new Error("Gate 0 input must be a status-only object")
  const keys = Object.keys(input)
  for (const key of keys) {
    if (!gate0Fields.includes(key)) throw new Error("Unknown Gate 0 field")
  }
  for (const field of gate0Fields) {
    if (!Object.hasOwn(input, field)) throw new Error("Missing Gate 0 field")
    if (typeof input[field] !== "string") throw new Error("Gate 0 input must be status-only")
    if (!gate0Statuses.includes(input[field])) throw new Error("Invalid Gate 0 status")
  }
  return Object.fromEntries(gate0Fields.map((field) => [field, { status: input[field] }]))
}

export function createFixture(name) {
  const pieces = {
    jwt: ["eyJ", "header", ".", "payload", ".", "signature"].join(""),
    cookie: ["Set-Cookie", ": session=fixture-value; Secure"].join(""),
    key: ["sb_", "secret_", "fixturevalue0123456789"].join(""),
    email: ["fixture-user", "@", "example.invalid"].join(""),
    uuid: ["12345678", "-1234-4abc-8def-", "1234567890ab"].join(""),
    "project-ref": ["SUPABASE_PROJECT_ID", "=fixtureprojectref123"].join(""),
    url: ["https", "://fixtureprojectref123.example.invalid/path"].join(""),
  }
  if (!fixtureNames.includes(name)) throw new Error(`Unknown redaction fixture: ${name}`)
  return pieces[name]
}

function redactString(value) {
  let output = value
  for (const pattern of [
    jwtPattern,
    authorizationPattern,
    cookiePattern,
    supabaseKeyPattern,
    legacyKeyPattern,
    emailPattern,
    uuidPattern,
    hostedUrlPattern,
    projectRefAssignmentPattern,
    credentialAssignmentPattern,
  ]) {
    output = output.replace(pattern, redacted)
  }
  return output
}

function gate0Check(name, value) {
  if (value === true || value?.status === "VERIFIED") return { name, status: "VERIFIED" }
  if (value === "REJECTED" || value?.status === "REJECTED") {
    return { name, status: "REJECTED", reason: value.reason ?? "resource-contradiction" }
  }
  if (value === "BLOCKED" || value?.status === "BLOCKED") {
    return { name, status: "MISSING", reason: value.reason ?? "resource-not-available" }
  }
  return { name, status: "MISSING" }
}

async function resolveSafeEvidencePath(outputPath) {
  if (typeof outputPath !== "string" || !outputPath.endsWith(".json")) {
    throw new Error("Evidence output must be a JSON path")
  }
  const target = path.resolve(outputPath)
  if (!allowedEvidenceRoots.some((root) => isWithin(root, target))) {
    throw new Error("Evidence output must be beneath an approved staging evidence directory")
  }
  return target
}

async function assertNoSymlinkComponents(directory) {
  const relative = path.relative(process.cwd(), directory)
  let candidate = process.cwd()
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    candidate = path.join(candidate, segment)
    try {
      if ((await lstat(candidate)).isSymbolicLink()) {
        throw new Error("Evidence path must not contain symlink components")
      }
    } catch (error) {
      if (error?.code === "ENOENT") return
      throw error
    }
  }
}

function projectUrlMatches(projectId, projectUrl) {
  if (!nonEmpty(projectId) || !isHttpsUrl(projectUrl)) return false
  try {
    return new URL(projectUrl).hostname === `${projectId}.supabase.co`
  } catch {
    return false
  }
}

function isHttpsUrl(value) {
  if (!nonEmpty(value)) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === ""
  } catch {
    return false
  }
}

function isWithin(root, target) {
  const relative = path.relative(root, target)
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

function resetAndTest(pattern, value) {
  pattern.lastIndex = 0
  return pattern.test(value)
}

function isSensitiveKey(key) {
  sensitiveKeyPattern.lastIndex = 0
  return sensitiveKeyPattern.test(key)
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0
}

function isPlainObject(value) {
  return (
    value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
  )
}
