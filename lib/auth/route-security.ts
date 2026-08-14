import { z } from "zod"
import { readRequestJson } from "@/lib/api/json"

export type ParsedJson<T> = Readonly<
  | {
      status: "success"
      value: T
    }
  | {
      status: "invalid_json"
    }
  | {
      status: "invalid_shape"
    }
>

export const emailRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().min(3).max(254).email(),
  })
  .strict()

export const passwordUpdateRequestSchema = z
  .object({
    password: z.string().min(8).max(72),
    passwordConfirmation: z.string().min(8).max(72),
  })
  .strict()
  .refine((value) => value.password === value.passwordConfirmation)

export type EmailRequest = z.infer<typeof emailRequestSchema>
export type PasswordUpdateRequest = z.infer<typeof passwordUpdateRequestSchema>

export function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (!origin) return false

  try {
    const originUrl = new URL(origin)
    const requestUrl = new URL(request.url)
    if (originUrl.origin === requestUrl.origin) return true

    const host = request.headers.get("host")
    return host !== null && originUrl.origin === new URL(`${requestUrl.protocol}//${host}`).origin
  } catch (error) {
    if (error instanceof TypeError) return false
    throw error
  }
}

export function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type")
  if (!contentType) return false

  const mediaType = contentType.split(";", 1)[0] ?? ""
  return mediaType.trim().toLowerCase() === "application/json"
}

export async function parseJsonWithSchema<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<ParsedJson<T>> {
  const json = await readRequestJson(request)
  if (json.status === "failure") return { status: "invalid_json" }

  const parsed = schema.safeParse(json.value)
  if (!parsed.success) return { status: "invalid_shape" }

  return { status: "success", value: parsed.data }
}
