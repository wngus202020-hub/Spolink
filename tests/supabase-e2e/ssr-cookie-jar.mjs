import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { createServerClient } from "@supabase/ssr"

const require = createRequire(import.meta.url)
const base64Prefix = "base64-"
const chunkSize = 3180

export class SsrCookieJar {
  #cookies = new Map()

  getAll() {
    return [...this.#cookies.values()]
      .filter((cookie) => cookie.value.length > 0)
      .map(({ name, value }) => ({ name, value }))
  }

  setAll(cookiesToSet) {
    for (const cookie of cookiesToSet) {
      this.setCookie(cookie)
    }
  }

  setCookie({ name, value, options = {} }) {
    if (value === "" || options.maxAge === 0) {
      this.#cookies.delete(name)
      return
    }
    this.#cookies.set(name, { name, options, value })
  }

  mergeSetCookieHeaders(headers) {
    for (const header of headers) {
      const parsed = parseSetCookie(header)
      this.setCookie(parsed)
    }
  }

  cookieHeader() {
    return this.getAll()
      .map(({ name, value }) => `${name}=${value}`)
      .join("; ")
  }

  authCookieNames() {
    return this.getAll()
      .map((cookie) => cookie.name)
      .filter((name) => name.includes("-auth-token"))
      .sort()
  }

  values() {
    return this.getAll().map((cookie) => cookie.value)
  }

  expireSessionMetadata() {
    const { baseName, cookies, session } = this.readSession()
    const expired = {
      ...session,
      expires_at: Math.floor(Date.now() / 1000) - 60,
    }
    assertPreservedTokens(session, expired)
    const encoded = `${base64Prefix}${base64UrlEncode(JSON.stringify(expired))}`
    for (const cookie of cookies) this.#cookies.delete(cookie.name)
    for (const chunk of createChunks(baseName, encoded)) {
      this.setCookie({ name: chunk.name, value: chunk.value, options: cookies[0].options })
    }
    return {
      baseName,
      expiredHash: sha256(encoded),
      originalHash: sha256(joinCookieValues(cookies)),
    }
  }

  addStaleAuthChunk() {
    const { baseName, cookies } = this.readSession()
    const staleName = `${baseName}.${cookies.length}`
    this.setCookie({ name: staleName, options: cookies[0].options, value: `${base64Prefix}e30` })
    return staleName
  }

  readSession() {
    const groups = new Map()
    for (const cookie of this.#cookies.values()) {
      const baseName = cookie.name.replace(/\.(0|[1-9][0-9]*)$/, "")
      if (!baseName.includes("-auth-token")) continue
      const group = groups.get(baseName) ?? []
      group.push(cookie)
      groups.set(baseName, group)
    }
    for (const [baseName, cookies] of groups) {
      const value = joinCookieValues(sortChunks(baseName, cookies))
      if (!value.startsWith(base64Prefix)) continue
      const session = JSON.parse(base64UrlDecode(value.slice(base64Prefix.length)))
      if (isSessionObject(session))
        return { baseName, cookies: sortChunks(baseName, cookies), session }
    }
    throw new Error("No Supabase SSR auth session cookie found")
  }
}

export async function createLearnerCookieJar({ status, email, password }) {
  const jar = new SsrCookieJar()
  const supabase = createServerClient(status.apiUrl, status.anonKey, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (cookiesToSet) => jar.setAll(cookiesToSet),
    },
  })
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  if (!data.user?.id) throw new Error("Learner sign-in did not return a user")
  jar.readSession()
  return jar
}

export async function assertSupabaseSsrContracts() {
  const packagePath = require.resolve("@supabase/ssr/package.json")
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"))
  if (packageJson.version !== "0.12.0") {
    throw new Error(`Expected @supabase/ssr 0.12.0, found ${packageJson.version}`)
  }
  const packageDir = path.dirname(packagePath)
  const [cookiesSource, chunkerSource] = await Promise.all([
    readFile(path.join(packageDir, "dist/module/cookies.js"), "utf8"),
    readFile(path.join(packageDir, "dist/module/utils/chunker.js"), "utf8"),
  ])
  if (!cookiesSource.includes('const BASE64_PREFIX = "base64-";')) {
    throw new Error("@supabase/ssr base64 prefix contract changed")
  }
  if (!chunkerSource.includes("export const MAX_CHUNK_SIZE = 3180;")) {
    throw new Error("@supabase/ssr chunk size contract changed")
  }
  return {
    packagePath,
    cookiesSha256: sha256(cookiesSource),
    chunkerSha256: sha256(chunkerSource),
  }
}

export function getSetCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie()
  }
  const header = response.headers.get("set-cookie")
  return header ? splitCombinedSetCookie(header) : []
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function parseSetCookie(header) {
  const parts = header.split(";").map((part) => part.trim())
  const [nameValue, ...attributes] = parts
  const separator = nameValue.indexOf("=")
  if (separator <= 0) throw new Error(`Invalid Set-Cookie header: ${header}`)
  const options = {}
  for (const attribute of attributes) {
    const [rawKey, ...rawValue] = attribute.split("=")
    const key = rawKey.toLowerCase()
    const value = rawValue.join("=")
    if (key === "path") options.path = value
    if (key === "domain") options.domain = value
    if (key === "max-age") options.maxAge = Number(value)
    if (key === "expires") options.expires = new Date(value)
    if (key === "httponly") options.httpOnly = true
    if (key === "secure") options.secure = true
    if (key === "samesite") options.sameSite = value
  }
  return { name: nameValue.slice(0, separator), options, value: nameValue.slice(separator + 1) }
}

function splitCombinedSetCookie(header) {
  return header.split(/,(?=\s*[^;,=]+=[^;,]+)/).map((value) => value.trim())
}

function createChunks(key, value) {
  let encodedValue = encodeURIComponent(value)
  if (encodedValue.length <= chunkSize) return [{ name: key, value }]
  const chunks = []
  while (encodedValue.length > 0) {
    let encodedHead = encodedValue.slice(0, chunkSize)
    const lastEscapePos = encodedHead.lastIndexOf("%")
    if (lastEscapePos > chunkSize - 3) encodedHead = encodedHead.slice(0, lastEscapePos)
    let valueHead = ""
    while (encodedHead.length > 0) {
      try {
        valueHead = decodeURIComponent(encodedHead)
        break
      } catch (error) {
        if (error instanceof URIError && encodedHead.at(-3) === "%" && encodedHead.length > 3) {
          encodedHead = encodedHead.slice(0, encodedHead.length - 3)
        } else {
          throw error
        }
      }
    }
    chunks.push(valueHead)
    encodedValue = encodedValue.slice(encodedHead.length)
  }
  return chunks.map((value, index) => ({ name: `${key}.${index}`, value }))
}

function sortChunks(baseName, cookies) {
  return [...cookies].sort(
    (left, right) => chunkIndex(baseName, left.name) - chunkIndex(baseName, right.name),
  )
}

function chunkIndex(baseName, name) {
  if (name === baseName) return -1
  return Number(name.slice(baseName.length + 1))
}

function joinCookieValues(cookies) {
  return cookies.map((cookie) => cookie.value).join("")
}

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8").toString("base64url")
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8")
}

function isSessionObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.access_token === "string" &&
    typeof value.refresh_token === "string" &&
    typeof value.token_type === "string" &&
    typeof value.expires_at === "number" &&
    value.user !== null &&
    typeof value.user === "object"
  )
}

function assertPreservedTokens(original, expired) {
  for (const key of ["access_token", "refresh_token", "token_type", "user"]) {
    if (JSON.stringify(original[key]) !== JSON.stringify(expired[key])) {
      throw new Error(`Expired session changed ${key}`)
    }
  }
}
