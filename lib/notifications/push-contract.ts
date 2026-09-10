import { z } from "zod"

const pushKeySchema = z
  .string()
  .min(16)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/u)

export const pushSubscriptionSchema = z
  .object({
    endpoint: z
      .string()
      .url()
      .min(20)
      .max(2048)
      .refine((value) => value.startsWith("https://")),
    expirationTime: z.number().int().positive().nullable(),
    keys: z
      .object({
        auth: pushKeySchema.max(64),
        p256dh: pushKeySchema.min(80),
      })
      .strict(),
  })
  .strict()

export const pushSubscriptionDisableSchema = z
  .object({ endpoint: pushSubscriptionSchema.shape.endpoint })
  .strict()

export const pushDeliveryBatchSchema = z
  .object({ limit: z.number().int().min(1).max(100).default(25) })
  .strict()

export type StoredPushSubscription = Readonly<z.infer<typeof pushSubscriptionSchema>>
export type PushSubscriptionDisable = Readonly<z.infer<typeof pushSubscriptionDisableSchema>>
