import { NextResponse } from "next/server.js"

export type ApiErrorShape = Readonly<{
  code: string
  message: string
  statusCode: number
}>

export function apiErrorResponse(error: ApiErrorShape, headers?: Headers) {
  return NextResponse.json(
    { error: { code: error.code, details: [], message: error.message } },
    { headers: withNoStore(headers), status: error.statusCode },
  )
}

export function apiDataResponse<T>(data: T, status: number, headers?: Headers) {
  return NextResponse.json(data, { headers: withNoStore(headers), status })
}

function withNoStore(headers?: Headers): Headers {
  const responseHeaders = new Headers(headers)
  responseHeaders.set("Cache-Control", "private, no-store")

  return responseHeaders
}
