import type { WorkflowResult } from "../profile/types"
import type {
  AdminReportQuery,
  AdminTrustSafetyDependencies,
  BlockData,
  CreateBlockData,
  CreateBlockInput,
  CreateReportInput,
  PageData,
  PageQuery,
  ReportData,
  RepositoryResult,
  ResolveReportData,
  ResolveReportInput,
  TrustSafetyDependencies,
} from "./types"

export async function runCreateReport(
  input: CreateReportInput,
  dependencies: TrustSafetyDependencies,
): Promise<WorkflowResult<Readonly<{ data: ReportData }>>> {
  const access = await dependencies.getAccess()
  if (access.kind !== "user") return userAccessFailure(access.kind)
  return mapMutation(await dependencies.createReport(input), 201)
}

export async function runListReports(
  query: PageQuery,
  dependencies: TrustSafetyDependencies,
): Promise<WorkflowResult<Readonly<{ data: PageData<ReportData> }>>> {
  const access = await dependencies.getAccess()
  if (access.kind === "restricted" || access.kind === "unauthenticated") {
    return userAccessFailure(access.kind)
  }
  return mapMutation(await dependencies.listReports(query, access.kind === "admin"), 200)
}

export async function runCreateBlock(
  input: CreateBlockInput,
  dependencies: TrustSafetyDependencies,
): Promise<WorkflowResult<Readonly<{ data: CreateBlockData }>>> {
  const access = await dependencies.getAccess()
  if (access.kind !== "user") return userAccessFailure(access.kind)
  const result = await dependencies.createBlock(input)
  return mapMutation(result, result.data?.idempotent === true ? 200 : 201)
}

export async function runListBlocks(
  query: PageQuery,
  dependencies: TrustSafetyDependencies,
): Promise<WorkflowResult<Readonly<{ data: PageData<BlockData> }>>> {
  const access = await dependencies.getAccess()
  if (access.kind !== "user") return userAccessFailure(access.kind)
  return mapMutation(await dependencies.listBlocks(query), 200)
}

export async function runListAdminReports(
  query: AdminReportQuery,
  dependencies: AdminTrustSafetyDependencies,
): Promise<WorkflowResult<Readonly<{ data: PageData<ReportData> }>>> {
  const access = await dependencies.getAccess()
  if (access.kind !== "admin") return adminAccessFailure(access.kind)
  return mapMutation(await dependencies.listReports(query), 200)
}

export async function runReadAdminReport(
  reportId: string,
  dependencies: AdminTrustSafetyDependencies,
): Promise<WorkflowResult<Readonly<{ data: ReportData }>>> {
  const access = await dependencies.getAccess()
  if (access.kind !== "admin") return adminAccessFailure(access.kind)
  return mapMutation(await dependencies.readReport(reportId), 200)
}

export async function runResolveAdminReport(
  input: ResolveReportInput,
  dependencies: AdminTrustSafetyDependencies,
): Promise<WorkflowResult<Readonly<{ data: ResolveReportData }>>> {
  const access = await dependencies.getAccess()
  if (access.kind !== "admin") return adminAccessFailure(access.kind)
  return mapMutation(await dependencies.resolveReport(input), 200)
}

function mapMutation<T>(
  result: RepositoryResult<T>,
  successStatus: number,
): WorkflowResult<Readonly<{ data: T }>> {
  if (!result.data || result.errorCode) return repositoryFailure(result.errorCode)
  return { response: { data: result.data }, status: "success", statusCode: successStatus }
}

function repositoryFailure(errorCode: string | null) {
  switch (errorCode) {
    case "22023":
      return failure("VALIDATION_ERROR", "Trust and safety request is invalid.", 422)
    case "23505":
      return failure("DUPLICATE_REPORT", "An open report already exists.", 409)
    case "42501":
      return failure("FORBIDDEN", "Trust and safety request is forbidden.", 403)
    case "P0001":
      return failure("CONFLICT", "Moderation state has changed.", 409)
    case "P0002":
      return failure("NOT_FOUND", "Trust and safety target was not found.", 404)
    default:
      return failure("INTERNAL_ERROR", "Unable to process trust and safety request.", 500)
  }
}

function userAccessFailure(kind: "admin" | "restricted" | "unauthenticated") {
  return kind === "unauthenticated"
    ? failure("UNAUTHORIZED", "Authentication required.", 401)
    : failure("FORBIDDEN", "Active user access is required.", 403)
}

function adminAccessFailure(kind: "restricted" | "unauthenticated" | "user") {
  return kind === "unauthenticated"
    ? failure("UNAUTHORIZED", "Authentication required.", 401)
    : failure("FORBIDDEN", "Active administrator access is required.", 403)
}

function failure(code: string, message: string, statusCode: number) {
  return { error: { code, message, statusCode }, status: "failure" as const }
}
