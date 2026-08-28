import { z } from "zod"

export const createReviewSchema = z
  .object({
    content: z.string().trim().min(1).max(2000),
    rating: z.number().int().min(1).max(5),
    reservationId: z.uuid(),
  })
  .strict()

export const hideReviewSchema = z.object({ reason: z.string().trim().min(1).max(200) }).strict()

export type CreateReviewRequest = z.infer<typeof createReviewSchema>
export type HideReviewRequest = z.infer<typeof hideReviewSchema>
