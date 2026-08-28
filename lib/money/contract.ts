import { z } from "zod"

export const uuidSchema = z.uuid()
export const refundResultSchema = z.strictObject({
  action: z.enum(["complete", "fail"]),
  providerRefundKey: z.string().trim().min(1).max(200).optional(),
  failureCode: z.string().trim().min(1).max(100).optional(),
  rawPayload: z.json().optional(),
  claimToken: z.uuid().optional(),
})
export const settlementHoldSchema = z.strictObject({ reason: z.string().trim().min(1).max(500) })
export const settlementGenerateSchema = z.strictObject({ reservationId: z.uuid() })
export const refundClaimSchema = z.strictObject({
  idempotencyKey: z.string().trim().min(1).max(200),
})

export type RefundResultInput = z.infer<typeof refundResultSchema>
