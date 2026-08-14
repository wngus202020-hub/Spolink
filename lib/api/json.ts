export type JsonReadResult = Readonly<
  | {
      status: "success"
      value: unknown
    }
  | {
      status: "failure"
    }
>

export async function readRequestJson(request: Request): Promise<JsonReadResult> {
  try {
    const value: unknown = await request.json()

    return { status: "success", value }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { status: "failure" }
    }

    throw error
  }
}
