import { DIRECT_TRIGGER } from "./constants.mjs"
import { readMode0600JsonFile } from "./utils.mjs"

export async function readInstallAuthorization(filePath) {
  const authorization = await readMode0600JsonFile(
    filePath,
    "Docker install authorization must be mode 0600",
  )
  if (
    authorization.schemaVersion !== 1 ||
    authorization.triggeringCommand !== DIRECT_TRIGGER ||
    authorization.requestedInstallerAction !== "brew install --cask docker" ||
    typeof authorization.runId !== "string" ||
    !authorization.runId ||
    !Number.isFinite(Date.parse(authorization.authorizedAt))
  ) {
    throw new Error("Invalid Docker install authorization")
  }
  return authorization
}
