import { access, readdir, readFile } from "node:fs/promises"
import path from "node:path"

const reservationApiRoot = "app/api/reservations/[reservationId]"
const completionPage = "app/reservations/[reservationId]/complete/page.tsx"
const buildManifest = ".next/app-path-routes-manifest.json"

export async function readReservationRouteInventory() {
  const entries = await readdir(reservationApiRoot, { withFileTypes: true })
  const routeModules = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const routeModule = path.posix.join(reservationApiRoot, entry.name, "route.ts")
    if (await exists(routeModule)) routeModules.push(routeModule)
  }

  return {
    buildRoutes: await readBuildRoutes(),
    completionPage: (await exists(completionPage)) ? completionPage : null,
    genericRoute: (await exists(path.posix.join(reservationApiRoot, "route.ts")))
      ? path.posix.join(reservationApiRoot, "route.ts")
      : null,
    routeModules: routeModules.sort(),
  }
}

async function readBuildRoutes() {
  if (!(await exists(buildManifest))) return null
  const manifest = JSON.parse(await readFile(buildManifest, "utf8"))
  return Object.values(manifest).sort()
}

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false
    }
    throw error
  }
}
