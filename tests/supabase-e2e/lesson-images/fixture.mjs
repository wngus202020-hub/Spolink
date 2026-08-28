import { createHash } from "node:crypto"

const personaDefinitions = Object.freeze([
  { key: "learner", role: "learner", status: "active" },
  { key: "otherLearner", role: "learner", status: "active" },
  { key: "coach", role: "coach", status: "coach_approved" },
  { key: "pendingCoach", role: "coach", status: "pending_coach" },
  { key: "admin", role: "admin", status: "active" },
])

export function createLessonImageFixtureNamespace(runId) {
  if (!/^[a-z0-9-]+$/u.test(runId)) throw new Error("Invalid lesson-image run id")
  const digest = sha256(runId)
  const counters = new Map()
  const deriveId = (kind, ordinal = 0) => uuidFrom(`${runId}:${kind}:${ordinal}`)
  const users = personaDefinitions.map((persona) => ({
    ...persona,
    displayName: `LI ${persona.key} ${digest.slice(0, 8)}`,
    email: `${persona.key}+li-${digest.slice(0, 16)}@spolink.test`,
    id: deriveId(`user:${persona.key}`),
  }))

  return {
    approvedCoachProfileId: deriveId("coach-profile:approved"),
    digest,
    foreignCoachProfileId: deriveId("coach-profile:foreign"),
    nextId(kind) {
      const ordinal = counters.get(kind) ?? 0
      counters.set(kind, ordinal + 1)
      return deriveId(kind, ordinal)
    },
    pendingCoachProfileId: deriveId("coach-profile:pending"),
    portBase: 20_000 + (Number.parseInt(digest.slice(0, 4), 16) % 20_000),
    runId,
    users,
  }
}

function uuidFrom(value) {
  const hex = sha256(value).slice(0, 32).split("")
  hex[12] = "4"
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  const joined = hex.join("")
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
