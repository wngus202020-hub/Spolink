import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const header = "# Netscape HTTP Cookie File"
const authNamePattern = /^(sb-[a-z0-9-]+-auth-token)(?:\.(0|[1-9][0-9]*))?$/

export async function assertLearnerCookieJar(cookieJarPath, baseUrl) {
  const url = new URL(baseUrl)
  assert.equal(url.protocol, "http:", "QA baseUrl must use local HTTP")
  assert.equal(url.hostname, "127.0.0.1", "QA baseUrl must use local loopback")
  const text = await readFile(cookieJarPath, "utf8")
  const lines = text.split(/\r?\n/)
  assert.equal(lines[0], header, "cookie jar must use the Netscape header")
  const rows = lines.slice(1).filter(Boolean)
  assert.equal(rows.length > 0, true, "cookie jar must contain an auth cookie")

  const names = new Set()
  let baseName = null
  const chunks = []
  for (const row of rows) {
    assert.equal(row.startsWith("#"), false, "cookie jar may not contain extra directives")
    const fields = row.split("\t")
    assert.equal(fields.length, 7, "Netscape cookie rows require seven tab-separated fields")
    const [domain, includeSubdomains, cookiePath, secure, expires, name, value] = fields
    assert.equal(domain, url.hostname, "cookie domain must match the configured local host")
    assert.equal(includeSubdomains, "FALSE", "local auth cookie must not include subdomains")
    assert.equal(cookiePath, "/", "local auth cookie path must be root")
    assert.equal(secure, "FALSE", "local HTTP auth cookie must not be marked secure")
    assert.match(expires, /^\d+$/, "cookie expiry must be a non-negative integer")
    assert.equal(value.length > 0, true, "auth cookie value must be non-empty")
    const match = name.match(authNamePattern)
    assert.notEqual(match, null, "cookie jar may contain only Supabase Auth cookies")
    assert.equal(names.has(name), false, "cookie jar may not contain duplicate cookie names")
    names.add(name)
    baseName ??= match[1]
    assert.equal(match[1], baseName, "cookie jar may contain only one learner auth session")
    chunks.push(match[2] === undefined ? null : Number(match[2]))
  }
  assertChunkShape(chunks)
}

function assertChunkShape(chunks) {
  if (chunks.includes(null)) {
    assert.deepEqual(chunks, [null], "unchunked auth cookies cannot be mixed with chunks")
    return
  }
  chunks.sort((left, right) => left - right)
  assert.deepEqual(
    chunks,
    chunks.map((_, index) => index),
    "auth cookie chunks must be contiguous",
  )
}
