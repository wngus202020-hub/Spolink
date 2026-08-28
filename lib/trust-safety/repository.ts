import type { BlockRow, ReportRow, TrustSafetyClient } from "./client"
import type {
  AdminReportQuery,
  AdminTrustSafetyDependencies,
  BlockData,
  PageData,
  PageQuery,
  ReportData,
  RepositoryResult,
  TrustSafetyDependencies,
} from "./types"

const SAFE_RPC_ERRORS = new Set(["22023", "23505", "42501", "P0001", "P0002"])

export function createTrustSafetyDependencies(client: TrustSafetyClient): TrustSafetyDependencies {
  return {
    createBlock: async (input) => {
      const result = await client.rpc("create_block", {
        checked_blocked_id: input.blockedId,
        checked_reason: input.reason,
      })
      const row = result.data?.length === 1 ? result.data[0] : null
      return row
        ? success({
            blockedId: row.blocked_id,
            createdAt: row.created_at,
            id: row.block_id,
            idempotent: row.idempotent,
            reason: row.reason,
          })
        : failure(result.error?.code)
    },
    createReport: async (input) => {
      const result = await client.rpc("create_report", {
        checked_detail: input.detail,
        checked_reason: input.reason,
        checked_target_id: input.targetId,
        checked_target_type: input.targetType,
      })
      const row = result.data?.length === 1 ? result.data[0] : null
      return row ? success(mapReport(row)) : failure(result.error?.code)
    },
    getAccess: () => readAccess(client),
    listBlocks: (query) => listBlocks(client, query),
    listReports: (query, includeAll) => listReports(client, query, includeAll),
  }
}

export function createAdminTrustSafetyDependencies(
  client: TrustSafetyClient,
): AdminTrustSafetyDependencies {
  return {
    getAccess: () => readAccess(client),
    listReports: (query) => listAdminReports(client, query),
    readReport: async (reportId) => {
      const result = await client.from("reports").select("*").eq("id", reportId).maybeSingle()
      return result.data ? success(mapReport(result.data)) : failure(result.error?.code ?? "P0002")
    },
    resolveReport: async (input) => {
      const result = await client.rpc("resolve_report", {
        checked_action: input.action,
        checked_moderation_action: input.moderationAction,
        checked_report_id: input.reportId,
        checked_resolution_note: input.resolutionNote,
      })
      const row = result.data?.length === 1 ? result.data[0] : null
      return row
        ? success({
            idempotent: row.idempotent,
            moderationAction: row.moderation_action,
            reportId: row.report_id,
            reviewedAt: row.reviewed_at,
            status: row.report_status,
          })
        : failure(result.error?.code)
    },
  }
}

async function readAccess(client: TrustSafetyClient) {
  const claims = await client.auth.getClaims()
  const userId = typeof claims.data?.claims.sub === "string" ? claims.data.claims.sub : null
  if (claims.error || !userId) return { kind: "unauthenticated" } as const

  const profile = await client
    .from("profiles")
    .select("id,role,status,deleted_at")
    .eq("id", userId)
    .maybeSingle()
  if (profile.error || !profile.data) return { kind: "restricted" } as const
  if (profile.data.deleted_at !== null || ["deleted", "suspended"].includes(profile.data.status)) {
    return { kind: "restricted" } as const
  }
  return profile.data.role === "admin"
    ? ({ kind: "admin", userId } as const)
    : ({ kind: "user", userId } as const)
}

async function listReports(
  client: TrustSafetyClient,
  query: PageQuery,
  includeAll: boolean,
): Promise<RepositoryResult<PageData<ReportData>>> {
  const start = (query.page - 1) * query.pageSize
  let request = client
    .from("reports")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(start, start + query.pageSize - 1)
  if (!includeAll) {
    const claims = await client.auth.getClaims()
    const userId = typeof claims.data?.claims.sub === "string" ? claims.data.claims.sub : ""
    request = request.eq("reporter_id", userId)
  }
  const result = await request
  return result.error
    ? failure(result.error.code)
    : success(pageData(result.data.map(mapReport), result.count ?? 0, query))
}

async function listAdminReports(
  client: TrustSafetyClient,
  query: AdminReportQuery,
): Promise<RepositoryResult<PageData<ReportData>>> {
  const start = (query.page - 1) * query.pageSize
  let request = client
    .from("reports")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(start, start + query.pageSize - 1)
  if (query.status === "open") {
    request = request.in("status", ["submitted", "reviewing"])
  } else if (query.status !== "all") {
    request = request.eq("status", query.status)
  }
  const result = await request
  return result.error
    ? failure(result.error.code)
    : success(pageData(result.data.map(mapReport), result.count ?? 0, query))
}

async function listBlocks(
  client: TrustSafetyClient,
  query: PageQuery,
): Promise<RepositoryResult<PageData<BlockData>>> {
  const start = (query.page - 1) * query.pageSize
  const result = await client
    .from("blocks")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(start, start + query.pageSize - 1)
  return result.error
    ? failure(result.error.code)
    : success(pageData(result.data.map(mapBlock), result.count ?? 0, query))
}

function mapReport(row: ReportRow): ReportData {
  return {
    createdAt: row.created_at,
    detail: row.detail,
    id: row.id,
    moderationAction: row.moderation_action,
    reason: row.reason,
    resolutionNote: row.resolution_note,
    reviewedAt: row.reviewed_at,
    status: row.status,
    targetId: row.target_id,
    targetType: row.target_type,
  }
}

function mapBlock(row: BlockRow): BlockData {
  return {
    blockedId: row.blocked_id,
    createdAt: row.created_at,
    id: row.id,
    reason: row.reason,
  }
}

function pageData<T>(items: readonly T[], total: number, query: PageQuery): PageData<T> {
  return { items, page: query.page, pageSize: query.pageSize, total }
}

function success<T>(data: T): RepositoryResult<T> {
  return { data, errorCode: null }
}

function failure<T>(errorCode: string | undefined): RepositoryResult<T> {
  return {
    data: null,
    errorCode: errorCode && SAFE_RPC_ERRORS.has(errorCode) ? errorCode : "INTERNAL_ERROR",
  }
}
