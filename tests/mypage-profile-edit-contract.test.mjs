import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import typescript from "typescript"

const workspaceUrl = pathToFileURL(`${process.cwd()}/`).href

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".ts")) {
      const loaded = nextLoad(url, { ...context, format: "module" })
      const source = typeof loaded.source === "string" ? loaded.source : loaded.source.toString()
      const result = typescript.transpileModule(source, {
        compilerOptions: {
          module: typescript.ModuleKind.ESNext,
          target: typescript.ScriptTarget.ES2022,
        },
        fileName: fileURLToPath(url),
      })
      return { format: "module", shortCircuit: true, source: result.outputText }
    }

    return nextLoad(url, context)
  },
  resolve(specifier, context, nextResolve) {
    const baseUrl = specifier.startsWith("@/")
      ? new URL(specifier.slice(2), workspaceUrl)
      : context.parentURL && specifier.startsWith(".")
        ? new URL(specifier, context.parentURL)
        : null

    if (baseUrl) {
      const candidate = new URL(`${baseUrl.href}.ts`)
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context)
    }

    return nextResolve(specifier, context)
  },
})

const { parsePatchProfileRequest } = await import("../lib/profile/validation.ts")
const { buildProfileEditPatch, mapProfileEditInitialData, parseProfileEditForm } = await import(
  "../lib/profile/edit-contract.ts"
)
const { parseProfileEditResponse, patchCurrentProfile } = await import(
  "../lib/profile/edit-client.ts"
)

const canonicalValues = {
  defaultRegion: "서울특별시 강남구",
  displayName: "러너",
  locationAgreed: true,
  marketingAgreed: false,
  phone: "010-1234-5678",
  realName: "홍길동",
}

const profileData = {
  avatarPath: null,
  coachProfile: null,
  defaultRegion: canonicalValues.defaultRegion,
  deletedAt: null,
  displayName: canonicalValues.displayName,
  id: "00000000-0000-4000-8000-000000000001",
  locationAgreedAt: "2026-08-22T00:00:00.000Z",
  marketingAgreedAt: null,
  phone: canonicalValues.phone,
  realName: canonicalValues.realName,
  role: "learner",
  status: "active",
}

test("baseline: current PATCH parser trims approved strings", () => {
  // Given: the current API parser receives an approved editable field.
  const input = { displayName: "  새 이름  " }

  // When: the existing PATCH boundary parses the request.
  const result = parsePatchProfileRequest(input)

  // Then: it keeps the established success/request shape and normalized value.
  assert.deepEqual(result, { request: { displayName: "새 이름" }, status: "success" })
})

test("baseline: current PATCH parser exposes no malformed input details", () => {
  // Given: the current API parser receives a forbidden owner field.
  const input = { id: "owner-controlled" }

  // When: the existing PATCH boundary parses the request.
  const result = parsePatchProfileRequest(input)

  // Then: it returns only the established safe failure shape.
  assert.deepEqual(result, { status: "failure" })
})

test("maps nullable row fields and consent timestamps into the six-field initial model", () => {
  // Given: an existing profile projection with nullable legacy values and consent timestamps.
  const row = {
    default_region: null,
    display_name: "  러너  ",
    location_agreed_at: "2026-08-22T00:00:00.000Z",
    marketing_agreed_at: null,
    phone: null,
    real_name: null,
  }

  // When: the browser-safe initial model is created.
  const result = mapProfileEditInitialData(row)

  // Then: nulls remain recoverable and timestamps become booleans without extra fields.
  assert.deepEqual(result, {
    defaultRegion: null,
    displayName: "러너",
    locationAgreed: true,
    marketingAgreed: false,
    phone: null,
    realName: null,
  })
})

test("normalizes approved strings and accepts only canonical regions", () => {
  // Given: all required values contain harmless surrounding whitespace.
  const input = Object.fromEntries(
    Object.entries(canonicalValues).map(([key, value]) => [
      key,
      typeof value === "string" ? `  ${value}  ` : value,
    ]),
  )

  // When: the edit form crosses the validation boundary.
  const result = parseProfileEditForm(input)

  // Then: it returns the normalized six-field model.
  assert.deepEqual(result, { status: "success", values: canonicalValues })
})

test("rejects invalid field shapes, missing required text, and non-canonical regions", () => {
  // Given: malformed form values including arbitrary region text and a non-boolean consent.
  const input = {
    ...canonicalValues,
    defaultRegion: "서울 강남구",
    locationAgreed: "yes",
    phone: "01012345678",
    realName: " ",
  }

  // When: the edit form crosses the validation boundary.
  const result = parseProfileEditForm(input)

  // Then: only safe field names identify retained-input validation failures.
  assert.equal(result.status, "failure")
  assert.deepEqual(
    [...result.fields].sort(),
    ["defaultRegion", "locationAgreed", "phone", "realName"].sort(),
  )
})

test("builds changed-only PATCH keys and returns null for a normalized no-op", () => {
  // Given: a normalized baseline and an edit with one text field plus both consent changes.
  const baseline = { ...canonicalValues, displayName: " 러너 " }
  const changed = {
    ...canonicalValues,
    displayName: "새 러너",
    locationAgreed: false,
    marketingAgreed: true,
  }

  // When: payloads are diffed against their normalized baseline.
  const patch = buildProfileEditPatch(baseline, changed)
  const noOp = buildProfileEditPatch(baseline, canonicalValues)

  // Then: only changed approved keys are emitted and no empty PATCH is represented.
  assert.deepEqual(patch, {
    displayName: "새 러너",
    locationAgreed: false,
    marketingAgreed: true,
  })
  assert.equal(noOp, null)
})

test("the payload source allowlist excludes owner, system, and avatar fields", () => {
  // Given: the owned contract source.
  const source = readFileSync("lib/profile/edit-contract.ts", "utf8")

  // When: its explicit PATCH key allowlist is inspected.
  const allowlist = source.match(/PROFILE_EDIT_PATCH_KEYS = \[([^\]]+)\]/s)?.[1] ?? ""

  // Then: all six approved keys exist and forbidden fields cannot enter the builder.
  assert.deepEqual(
    [...allowlist.matchAll(/"([A-Za-z]+)"/g)].map((match) => match[1]),
    ["displayName", "realName", "phone", "defaultRegion", "locationAgreed", "marketingAgreed"],
  )
  assert.doesNotMatch(allowlist, /avatarPath|id|role|status|deletedAt|createdAt|updatedAt/)
})

test("architecture: edit consumers use the shared canonical profile-region contract", () => {
  // Given: the browser edit contract and picker consumer sources.
  const editContractSource = readFileSync("lib/profile/edit-contract.ts", "utf8")
  const pickerSource = readFileSync("components/profile/profile-region-picker.tsx", "utf8")

  // When: their canonical-region dependencies are inspected.
  // Then: both consume the one shared contract without private membership definitions.
  assert.match(
    editContractSource,
    /import\s*\{\s*canonicalProfileRegionSchema\s*\}\s*from\s*["']\.\/region-contract["']/u,
  )
  assert.doesNotMatch(editContractSource, /canonicalRegions|lessonRegions/u)
  assert.match(
    pickerSource,
    /import\s*\{\s*isCanonicalProfileRegion\s*\}\s*from\s*["']@\/lib\/profile\/region-contract["']/u,
  )
  assert.doesNotMatch(
    pickerSource,
    /canonicalProfileRegionValues|function isCanonicalProfileRegion/u,
  )
})

test("parses a strict camelCase success response into the new baseline", () => {
  // Given: the current successful ProfileData response.
  const body = { data: profileData }

  // When: the response boundary parses it.
  const result = parseProfileEditResponse(200, body)

  // Then: only the six editable fields become the new baseline.
  assert.deepEqual(result, { baseline: canonicalValues, status: "success" })
})

test("ignores malformed unrelated success fields while parsing the edit baseline", () => {
  // Given: the server includes unrelated profile/account fields that the edit UI must not store.
  const body = {
    data: {
      ...profileData,
      avatarPath: 42,
      coachProfile: { id: "not-a-uuid", status: "unexpected" },
      deletedAt: "not-a-date",
      id: "not-a-uuid",
      role: "owner",
      status: "ghost",
    },
  }

  // When: the profile-edit client parses a successful mutation response.
  const result = parseProfileEditResponse(200, body)

  // Then: unrelated malformed fields do not block or enter the six-field baseline.
  assert.deepEqual(result, { baseline: canonicalValues, status: "success" })
})

test("rejects malformed required edit fields in a success response", () => {
  // Given: the response corrupts an editable field required for the new baseline.
  const body = { data: { ...profileData, displayName: 42 } }

  // When: the profile-edit client parses the response.
  const result = parseProfileEditResponse(200, body)

  // Then: the malformed edit field is rejected as a retryable malformed response.
  assert.deepEqual(result, { category: "retry", reason: "malformed_response", status: "failure" })
})

test("maps authenticated account errors to exact safe destinations", () => {
  // Given: valid API error envelopes for every navigation category.
  const scenarios = [
    [401, "UNAUTHORIZED", "login", "/auth/login?next=/mypage/profile"],
    [403, "ACCOUNT_SUSPENDED", "restricted", "/auth/restricted?reason=account-suspended"],
    [403, "ACCOUNT_DELETED", "restricted", "/auth/restricted?reason=account-deleted"],
    [409, "PROFILE_REQUIRED", "onboarding", "/onboarding/profile"],
  ]

  for (const [statusCode, code, category, destination] of scenarios) {
    // When: the response boundary parses the error.
    const result = parseProfileEditResponse(statusCode, {
      error: { code, message: "safe", statusCode },
    })

    // Then: the result exposes only the intended category and destination.
    assert.deepEqual(result, { category, destination, status: "failure" })
  }
})

test("distinguishes retained-input validation from retryable failures", () => {
  // Given: valid validation/server envelopes plus malformed and unknown responses.
  const validation = { error: { code: "VALIDATION_ERROR", message: "safe", statusCode: 422 } }
  const server = { error: { code: "INTERNAL_ERROR", message: "safe", statusCode: 500 } }

  // When: each response crosses the parser.
  const results = [
    parseProfileEditResponse(422, validation),
    parseProfileEditResponse(500, server),
    parseProfileEditResponse(503, { nope: true }),
    parseProfileEditResponse(200, { data: { displayName: 42 } }),
    parseProfileEditResponse(418, { error: "unknown" }),
  ]

  // Then: input retention and retry reasons remain explicit without accepting malformed bodies.
  assert.deepEqual(results, [
    { category: "validation", retainInput: true, status: "failure" },
    { category: "retry", reason: "server", status: "failure" },
    { category: "retry", reason: "server", status: "failure" },
    { category: "retry", reason: "malformed_response", status: "failure" },
    { category: "retry", reason: "malformed_response", status: "failure" },
  ])
})

test("PATCH client emits only the supplied approved keys and parses success", async () => {
  // Given: one changed text field and one changed consent with a recording request seam.
  const emitted = []
  const patch = { displayName: "새 러너", marketingAgreed: true }
  const request = async (url, options) => {
    emitted.push({ keys: Object.keys(options.json).sort(), method: options.method, url })
    return new Response(JSON.stringify({ data: profileData }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })
  }

  // When: the browser PATCH client performs the mutation.
  const result = await patchCurrentProfile(patch, { request })

  // Then: the wire seam sees only changed field names and a safe parsed success union.
  assert.deepEqual(emitted, [
    { keys: ["displayName", "marketingAgreed"], method: "patch", url: "/api/profiles/me" },
  ])
  assert.deepEqual(result, { baseline: canonicalValues, status: "success" })
})

test("PATCH client sends no request for empty/forbidden input and maps network failure", async () => {
  // Given: a request seam that fails if invoked for invalid input and throws for a valid patch.
  let requestCount = 0
  const request = async () => {
    requestCount += 1
    throw new TypeError("network unavailable")
  }

  // When: no-op, forbidden, and valid inputs are attempted.
  const noOp = await patchCurrentProfile(null, { request })
  const forbidden = await patchCurrentProfile({ avatarPath: "forbidden" }, { request })
  const network = await patchCurrentProfile({ displayName: "새 러너" }, { request })

  // Then: invalid inputs never reach the wire and network failure is retryable.
  assert.deepEqual(noOp, { status: "no_changes" })
  assert.deepEqual(forbidden, { category: "validation", retainInput: true, status: "failure" })
  assert.deepEqual(network, { category: "retry", reason: "network", status: "failure" })
  assert.equal(requestCount, 1)
})
