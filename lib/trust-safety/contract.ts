import { z } from "zod"

import {
  type AdminReportQuery,
  MODERATION_ACTIONS,
  type PageQuery,
  REPORT_ACTIONS,
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
} from "./types"

export const createReportSchema = z.strictObject({
  detail: z.string().trim().min(1).max(1000).nullable().optional(),
  reason: z.string().trim().min(1).max(100),
  targetId: z.uuid(),
  targetType: z.enum(REPORT_TARGET_TYPES),
})

export const createBlockSchema = z.strictObject({
  blockedId: z.uuid(),
  reason: z.string().trim().min(1).max(200).nullable().optional(),
})

export const resolveReportSchema = z.strictObject({
  action: z.enum(REPORT_ACTIONS),
  moderationAction: z.enum(MODERATION_ACTIONS),
  resolutionNote: z.string().trim().min(1).max(1000).nullable().optional(),
})

const pageSchema = z.coerce.number().int().min(1).max(10000).default(1)
const pageSizeSchema = z.coerce.number().int().min(1).max(50).default(20)

export function parsePageQuery(searchParams: URLSearchParams): PageQuery | null {
  const parsed = z
    .object({ page: pageSchema, pageSize: pageSizeSchema })
    .safeParse(Object.fromEntries(searchParams))
  return parsed.success ? parsed.data : null
}

export function parseAdminReportQuery(searchParams: URLSearchParams): AdminReportQuery | null {
  for (const key of ["page", "pageSize", "status"] as const) {
    if (searchParams.getAll(key).length > 1) return null
  }
  const parsed = z
    .object({
      page: pageSchema,
      pageSize: pageSizeSchema,
      status: z.enum(["all", "open", ...REPORT_STATUSES]).default("all"),
    })
    .safeParse(Object.fromEntries(searchParams))
  return parsed.success ? parsed.data : null
}
