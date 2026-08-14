import {
  approvedCommandPlan,
  classifyCommand,
  validateStagingContract,
  writeSafeEvidence,
} from "./contract.mjs"

const caseName = readOption("--case")
const expected = readOption("--expect")?.toUpperCase()

try {
  const evidence = runCase(caseName)
  if (!expected || evidence.verdict !== expected) {
    throw new Error("Fake command result did not match the expected verdict")
  }
  if (caseName === "valid-contract") {
    await writeSafeEvidence(".omo/evidence/staging-contract/task-2-contract.json", evidence)
  }
  console.log(JSON.stringify(evidence))
} catch (error) {
  console.error(error instanceof Error ? error.message : "Fake command test failed")
  process.exitCode = 1
}

function runCase(name) {
  if (name === "forbidden-commands") return forbiddenCommandEvidence()
  if (name === "invalid-contract") return invalidContractEvidence()
  if (name === "valid-contract") return approvedCommandPlan(validContract())
  throw new Error("Unknown --case value")
}

function forbiddenCommandEvidence() {
  const fixtures = [
    ["supabase", "db", "reset", "--linked"].join(" "),
    ["supabase", "migration", "down"].join(" "),
    ["supabase", "db", "push", "--linked", "--include-seed"].join(" "),
    ["rm", "-rf", "fixture-output"].join(" "),
    ["rewrite", "supabase/config.toml"].join(" "),
  ]
  const blocked = fixtures.map(classifyCommand)
  return {
    schemaVersion: 1,
    case: "forbidden-commands",
    verdict: blocked.every((item) => item.verdict === "REJECT") ? "REJECT" : "APPROVE",
    providerCommandsStarted: 0,
    blockedCommands: blocked.map((item) => ({ category: item.category })),
  }
}

function invalidContractEvidence() {
  const base = validContract()
  const cases = [
    { ...base, SUPABASE_PROJECT_ID: "", expectedProjectUrl: "" },
    { ...base, expectedStagingOrigin: base.expectedStagingOrigin.replace("https", "http") },
    { ...base, originCategory: "production" },
    { ...base, projectCategory: "production" },
    {
      ...base,
      expectedProjectUrl: base.expectedProjectUrl.replace(base.SUPABASE_PROJECT_ID, "other"),
    },
    { ...base, vercelEnvironment: "unexpected" },
  ].map(validateStagingContract)
  return {
    schemaVersion: 1,
    case: "invalid-contract",
    verdict: cases.every((item) => item.verdict === "REJECT") ? "REJECT" : "APPROVE",
    providerCommandsStarted: 0,
    rejected: cases.map((item) => ({ reasons: item.reasons })),
  }
}

function validContract() {
  const projectId = ["fixture", "staging", "ref123"].join("")
  return {
    SUPABASE_PROJECT_ID: projectId,
    expectedProjectUrl: ["https", "://", projectId, ".supabase.co"].join(""),
    expectedStagingOrigin: ["https", "://staging.example.invalid"].join(""),
    originCategory: "staging",
    projectCategory: "staging",
    productionProjectId: ["fixture", "production", "ref456"].join(""),
    vercelEnvironment: "staging",
  }
}

function readOption(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
