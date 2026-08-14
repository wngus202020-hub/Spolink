import {
  containsSensitiveMaterial,
  createFixture,
  fixtureNames,
  redactForEvidence,
  writeSafeEvidence,
} from "./contract.mjs"

const requested = readOption("--fixtures")?.split(",").filter(Boolean) ?? []

try {
  if (requested.length === 0 || requested.some((name) => !fixtureNames.includes(name))) {
    throw new Error("--fixtures must contain only supported redaction fixture names")
  }
  const fixtures = requested.map((name) => {
    const raw = createFixture(name)
    const sanitized = redactForEvidence({ value: raw })
    return {
      name,
      masked: sanitized.value !== raw && sanitized.value.includes("<redacted>"),
      rawPatternCount: containsSensitiveMaterial(sanitized) ? 1 : 0,
    }
  })
  const evidence = {
    schemaVersion: 1,
    verdict: fixtures.every((item) => item.masked && item.rawPatternCount === 0)
      ? "APPROVE"
      : "REJECT",
    providerCommandsStarted: 0,
    fixtures,
  }
  await writeSafeEvidence(".omo/evidence/staging-contract/redaction-tests.json", evidence)
  console.log(JSON.stringify(evidence))
  if (evidence.verdict !== "APPROVE") process.exitCode = 1
} catch (error) {
  console.error(error instanceof Error ? error.message : "Redaction test failed")
  process.exitCode = 1
}

function readOption(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
