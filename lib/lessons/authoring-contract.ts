import { z } from "zod"

const nullableText = (maximum: number) => z.string().trim().max(maximum).nullable().optional()

export const lessonDraftSchema = z
  .strictObject({
    address: nullableText(300),
    cancellationPolicySummary: nullableText(1000),
    capacity: z.number().int().min(1).max(100),
    description: z.string().trim().min(10).max(3000),
    durationMinutes: z.number().int().min(10).max(480),
    latitude: z.number().finite().min(-90).max(90).nullable().optional(),
    longitude: z.number().finite().min(-180).max(180).nullable().optional(),
    placeName: nullableText(200),
    preparation: nullableText(1000),
    priceAmount: z.number().int().min(0).max(10_000_000),
    region: z.string().trim().min(2).max(100),
    sportId: z.uuid(),
    summary: nullableText(500),
    title: z.string().trim().min(2).max(100),
  })
  .superRefine((value, context) => {
    const hasLatitude = value.latitude !== null && value.latitude !== undefined
    const hasLongitude = value.longitude !== null && value.longitude !== undefined
    if (hasLatitude !== hasLongitude) {
      context.addIssue({
        code: "custom",
        message: "Latitude and longitude must be provided together.",
      })
    }
    if (hasLatitude && !value.address) {
      context.addIssue({ code: "custom", message: "Coordinates require an address." })
    }
  })

export const lessonUpdateSchema = lessonDraftSchema.safeExtend({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
})

export const lessonTransitionSchema = z.strictObject({
  action: z.enum(["approve", "close", "pause", "reject", "resume", "submit"]),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  reason: nullableText(1000),
})

export const scheduleCreateSchema = z
  .strictObject({
    capacity: z.number().int().min(1).max(100),
    endsAt: z.iso.datetime({ offset: true }),
    startsAt: z.iso.datetime({ offset: true }),
  })
  .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt))

export const scheduleUpdateSchema = scheduleCreateSchema.extend({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
})

export const scheduleCloseSchema = z.strictObject({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
})

export type LessonDraftInput = z.infer<typeof lessonDraftSchema>
export type LessonUpdateInput = z.infer<typeof lessonUpdateSchema>
export type LessonTransitionInput = z.infer<typeof lessonTransitionSchema>
export type ScheduleCreateInput = z.infer<typeof scheduleCreateSchema>
export type ScheduleUpdateInput = z.infer<typeof scheduleUpdateSchema>
export type ScheduleCloseInput = z.infer<typeof scheduleCloseSchema>
