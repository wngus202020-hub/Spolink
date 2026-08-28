export const REPORT_TARGET_TYPES = ["user", "coach", "lesson", "review", "reservation"] as const
export const REPORT_STATUSES = ["submitted", "reviewing", "resolved", "rejected"] as const
export const MODERATION_ACTIONS = ["none", "hide_lesson", "hide_review", "suspend_user"] as const
export const REPORT_ACTIONS = ["start_review", "resolve", "reject"] as const

export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number]
export type ReportStatus = (typeof REPORT_STATUSES)[number]
export type ModerationAction = (typeof MODERATION_ACTIONS)[number]
export type ReportAction = (typeof REPORT_ACTIONS)[number]

export type CreateReportInput = Readonly<{
  detail: string | null
  reason: string
  targetId: string
  targetType: ReportTargetType
}>

export type CreateBlockInput = Readonly<{
  blockedId: string
  reason: string | null
}>

export type ResolveReportInput = Readonly<{
  action: ReportAction
  moderationAction: ModerationAction
  reportId: string
  resolutionNote: string | null
}>

export type ReportData = Readonly<{
  createdAt: string
  detail: string | null
  id: string
  moderationAction: ModerationAction | null
  reason: string
  resolutionNote: string | null
  reviewedAt: string | null
  status: ReportStatus
  targetId: string
  targetType: ReportTargetType
}>

export type BlockData = Readonly<{
  blockedId: string
  createdAt: string
  id: string
  reason: string | null
}>

export type CreateBlockData = BlockData & Readonly<{ idempotent: boolean }>
export type ResolveReportData = Readonly<{
  idempotent: boolean
  moderationAction: ModerationAction
  reportId: string
  reviewedAt: string
  status: ReportStatus
}>

export type PageQuery = Readonly<{ page: number; pageSize: number }>
export type AdminReportQuery = PageQuery & Readonly<{ status: ReportStatus | "all" | "open" }>
export type PageData<T> = Readonly<{
  items: readonly T[]
  page: number
  pageSize: number
  total: number
}>

export type Access =
  | Readonly<{ kind: "admin"; userId: string }>
  | Readonly<{ kind: "restricted" }>
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "user"; userId: string }>

export type RepositoryResult<T> = Readonly<{
  data: T | null
  errorCode: string | null
}>

export type TrustSafetyDependencies = Readonly<{
  createBlock: (input: CreateBlockInput) => Promise<RepositoryResult<CreateBlockData>>
  createReport: (input: CreateReportInput) => Promise<RepositoryResult<ReportData>>
  getAccess: () => Promise<Access>
  listBlocks: (query: PageQuery) => Promise<RepositoryResult<PageData<BlockData>>>
  listReports: (
    query: PageQuery,
    includeAll: boolean,
  ) => Promise<RepositoryResult<PageData<ReportData>>>
}>

export type AdminTrustSafetyDependencies = Readonly<{
  getAccess: () => Promise<Access>
  listReports: (query: AdminReportQuery) => Promise<RepositoryResult<PageData<ReportData>>>
  readReport: (reportId: string) => Promise<RepositoryResult<ReportData>>
  resolveReport: (input: ResolveReportInput) => Promise<RepositoryResult<ResolveReportData>>
}>
