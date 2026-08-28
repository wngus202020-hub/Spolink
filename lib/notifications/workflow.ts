import type { AuthUser } from "@/lib/profile/types"
import type { NotificationRepository } from "./repository"
import type { NotificationPage, NotificationQuery } from "./types"

type Access = Readonly<{
  profileId: string
  user: AuthUser
}>

export type NotificationWorkflowDependencies = Readonly<{
  getAccess: () => Promise<Access | "unauthenticated" | "restricted">
  repository: NotificationRepository
}>

export async function runListNotifications(
  query: NotificationQuery,
  dependencies: NotificationWorkflowDependencies,
) {
  const access = await dependencies.getAccess()
  if (access === "unauthenticated") return failure("UNAUTHORIZED", "Authentication required.", 401)
  if (access === "restricted") return failure("FORBIDDEN", "Notification access is forbidden.", 403)
  const data = await dependencies.repository.list(access.profileId, query)
  return data
    ? { response: { data }, status: "success" as const, statusCode: 200 as const }
    : failure("INTERNAL_ERROR", "Unable to read notifications.", 500)
}

export async function runMarkNotificationRead(
  notificationId: string,
  dependencies: NotificationWorkflowDependencies,
) {
  const access = await dependencies.getAccess()
  if (access === "unauthenticated") return failure("UNAUTHORIZED", "Authentication required.", 401)
  if (access === "restricted") return failure("FORBIDDEN", "Notification access is forbidden.", 403)
  const result = await dependencies.repository.markRead(access.profileId, notificationId)
  if (result === "error") return failure("INTERNAL_ERROR", "Unable to update notification.", 500)
  if (result === "not_found") return failure("NOT_FOUND", "Notification was not found.", 404)
  return {
    response: { data: { notificationId, read: true } },
    status: "success" as const,
    statusCode: 200 as const,
  }
}

export type NotificationWorkflowResult =
  | {
      response: { data: NotificationPage | Readonly<{ notificationId: string; read: true }> }
      status: "success"
      statusCode: 200
    }
  | { error: { code: string; message: string; statusCode: number }; status: "failure" }

function failure(code: string, message: string, statusCode: number): NotificationWorkflowResult {
  return { error: { code, message, statusCode }, status: "failure" }
}

export type { NotificationQuery }
