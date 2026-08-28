import ky from "ky"
import { z } from "zod"

import type { FavoriteMutationAction } from "./mutation-workflow"

const favoriteResponseSchema = z
  .object({
    data: z
      .object({
        changed: z.boolean(),
        favorited: z.boolean(),
        lessonId: z.string().uuid(),
      })
      .strict(),
  })
  .strict()

const favoriteErrorSchema = z
  .object({ error: z.object({ code: z.string() }).passthrough() })
  .passthrough()

export type FavoriteClientResult = Readonly<
  | { changed: boolean; favorited: boolean; status: "success" }
  | {
      code: "FORBIDDEN" | "NETWORK_ERROR" | "PROFILE_REQUIRED" | "UNAUTHORIZED" | "UNAVAILABLE"
      message: string
      status: "failure"
    }
>

type FavoriteClientErrorCode =
  | "FORBIDDEN"
  | "NETWORK_ERROR"
  | "PROFILE_REQUIRED"
  | "UNAUTHORIZED"
  | "UNAVAILABLE"

export async function mutateFavorite(
  action: FavoriteMutationAction,
  lessonId: string,
): Promise<FavoriteClientResult> {
  let response: Response
  try {
    response = await ky("/api/favorites", {
      cache: "no-store",
      credentials: "same-origin",
      json: { lessonId },
      method: action === "add" ? "post" : "delete",
      retry: 0,
      throwHttpErrors: false,
      timeout: 5_000,
    })
  } catch (error) {
    if (error instanceof Error) return failure("NETWORK_ERROR")
    throw error
  }

  const body = await readJson(response)
  if (!response.ok) {
    const parsedError = favoriteErrorSchema.safeParse(body)
    return failure(mapErrorCode(parsedError.success ? parsedError.data.error.code : null))
  }

  const parsed = favoriteResponseSchema.safeParse(body)
  if (!parsed.success || parsed.data.data.lessonId !== lessonId) return failure("UNAVAILABLE")

  return {
    changed: parsed.data.data.changed,
    favorited: parsed.data.data.favorited,
    status: "success",
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

function mapErrorCode(code: string | null): FavoriteClientErrorCode {
  if (code === "UNAUTHORIZED") return "UNAUTHORIZED"
  if (code === "PROFILE_REQUIRED") return "PROFILE_REQUIRED"
  if (code === "FORBIDDEN" || code === "ACCOUNT_DELETED" || code === "ACCOUNT_SUSPENDED") {
    return "FORBIDDEN"
  }
  return "UNAVAILABLE"
}

function failure(code: FavoriteClientErrorCode): FavoriteClientResult {
  switch (code) {
    case "UNAUTHORIZED":
      return { code, message: "로그인 후 찜을 변경할 수 있어요.", status: "failure" }
    case "PROFILE_REQUIRED":
      return { code, message: "프로필 설정을 완료한 뒤 찜을 변경해요.", status: "failure" }
    case "FORBIDDEN":
      return { code, message: "학습자 계정에서만 찜을 변경할 수 있어요.", status: "failure" }
    case "NETWORK_ERROR":
      return { code, message: "연결이 원활하지 않아요. 잠시 후 다시 시도해요.", status: "failure" }
    case "UNAVAILABLE":
      return {
        code,
        message: "찜 상태를 변경하지 못했어요. 페이지를 새로고침해요.",
        status: "failure",
      }
  }
}
