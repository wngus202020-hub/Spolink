import { NextResponse } from "next/server"

export function authJsonData<T>(data: T, status: number, headers?: Headers) {
  return NextResponse.json({ data }, { headers: withNoStore(headers), status })
}

export function authJsonError(code: string, message: string, status: number, headers?: Headers) {
  return NextResponse.json(
    { error: { code, details: [], message } },
    { headers: withNoStore(headers), status },
  )
}

export function authRedirect(location: string, status = 303, headers?: Headers) {
  const response = NextResponse.redirect(new URL(location, "http://127.0.0.1"), {
    headers: withNoStore(headers),
    status,
  })
  response.headers.set("Location", location)
  return response
}

export function withNoStore(headers?: Headers): Headers {
  const responseHeaders = new Headers(headers)
  responseHeaders.set("Cache-Control", "private, no-store")
  return responseHeaders
}
