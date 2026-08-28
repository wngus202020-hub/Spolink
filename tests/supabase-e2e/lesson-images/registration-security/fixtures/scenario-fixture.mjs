const labels = [
  "spoof_metadata_magic_byte_boundary",
  "valid_image/jpeg",
  "valid_image/png",
  "valid_image/webp",
]

export async function runLessonImageRpcBoundarySecurityScenario() {
  if (process.env.SPOLINK_RPC_BOUNDARY_FIXTURE_MODE === "no-op") {
    return { cleanup: null, observations: [] }
  }

  return {
    cleanup: { authUsers: 0, images: 0, intents: 0, lessons: 0, objects: 0 },
    observations: labels.map((label) => ({ label })),
  }
}
