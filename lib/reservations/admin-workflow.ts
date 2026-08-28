import type { WorkflowResult } from "../profile/types"
import type {
  AdminReservation,
  AdminReservationAction,
  AdminReservationDependencies,
  AdminReservationPage,
  AdminReservationQuery,
  AdminReservationResult,
  AdminReservationStatus,
} from "./admin-operations"

export function runAdminReservationList(
  query: AdminReservationQuery,
  dependencies: AdminReservationDependencies,
): Promise<WorkflowResult<Readonly<{ data: AdminReservationPage }>>>
export async function runAdminReservationList(
  query: AdminReservationQuery,
  dependencies: AdminReservationDependencies,
) {
  const access = await dependencies.getAccess()
  if (access.kind !== "admin") return accessFailure(access.kind)
  return readResult(await dependencies.listReservations(query))
}

export async function runAdminReservationRead(
  reservationId: string,
  dependencies: AdminReservationDependencies,
): Promise<WorkflowResult<Readonly<{ data: AdminReservation }>>> {
  const access = await dependencies.getAccess()
  if (access.kind !== "admin") return accessFailure(access.kind)
  return readResult(await dependencies.readReservation(reservationId))
}

export async function runAdminReservationStatus(
  reservationId: string,
  action: AdminReservationAction,
  reason: string | null,
  dependencies: AdminReservationDependencies,
): Promise<WorkflowResult<Readonly<{ data: AdminReservationStatus }>>> {
  const access = await dependencies.getAccess()
  if (access.kind !== "admin") return accessFailure(access.kind)
  const result = await dependencies.transitionReservation(reservationId, action, reason)
  if (result.data && !result.errorCode)
    return { response: { data: result.data }, status: "success", statusCode: 200 }
  return failureFor(result.errorCode)
}

function readResult<T>(result: AdminReservationResult<T>): WorkflowResult<Readonly<{ data: T }>> {
  if (result.data && !result.errorCode)
    return { response: { data: result.data }, status: "success", statusCode: 200 }
  return failureFor(result.errorCode)
}

function accessFailure(kind: "forbidden" | "unauthenticated") {
  return kind === "unauthenticated"
    ? failure("UNAUTHORIZED", "Authentication required.", 401)
    : failure("FORBIDDEN", "Active administrator access is required.", 403)
}

function failureFor(errorCode: string | null) {
  switch (errorCode) {
    case "P0002":
      return failure("NOT_FOUND", "Reservation not found.", 404)
    case "42501":
      return failure("FORBIDDEN", "Reservation operation is forbidden.", 403)
    case "22023":
      return failure("VALIDATION_ERROR", "Reservation operation is invalid.", 422)
    case "P0001":
    case "23505":
      return failure("CONFLICT", "Reservation state has changed.", 409)
    default:
      return failure("INTERNAL_ERROR", "Unable to process reservation operation.", 500)
  }
}

function failure(code: string, message: string, statusCode: 401 | 403 | 404 | 409 | 422 | 500) {
  return { error: { code, message, statusCode }, status: "failure" as const }
}
