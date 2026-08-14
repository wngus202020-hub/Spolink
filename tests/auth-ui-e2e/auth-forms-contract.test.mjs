import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import test from "node:test"

const authUiFiles = Object.freeze([
  "app/auth/check-email/page.tsx",
  "app/auth/login/page.tsx",
  "app/auth/reset-password/page.tsx",
  "app/auth/signup/page.tsx",
  "app/auth/update-password/page.tsx",
  "components/auth/auth-client-routes.ts",
  "components/auth/auth-fields.tsx",
  "components/auth/auth-shell.tsx",
  "components/auth/login-form.tsx",
  "components/auth/reset-password-form.tsx",
  "components/auth/signup-form.tsx",
  "components/auth/update-password-form.tsx",
  "lib/auth/update-password-page.ts",
])

const authFormsAggregator = "tests/auth-ui-e2e/auth-forms.spec.ts"

const splitAuthSpecFiles = Object.freeze([
  "tests/auth-ui-e2e/auth-accessibility-security.spec.ts",
  "tests/auth-ui-e2e/auth-login.spec.ts",
  "tests/auth-ui-e2e/auth-signup-reset.spec.ts",
  "tests/auth-ui-e2e/auth-update-password.spec.ts",
])

const authSpecFiles = Object.freeze([authFormsAggregator, ...splitAuthSpecFiles])

const authHelperFiles = Object.freeze([
  "playwright.auth.config.ts",
  "tests/auth-ui-e2e/auth-form-helpers.ts",
  "tests/auth-ui-e2e/auth-recovery-helpers.ts",
  "tests/auth-ui-e2e/raw-output.mjs",
  "tests/auth-ui-e2e/run-auth-forms.mjs",
])

const forbiddenUiPatterns = Object.freeze([
  "ComingSoonPage",
  "준비중",
  "OAuth",
  "소셜 로그인",
  "magic link",
  "Magic Link",
  "localStorage",
  "sessionStorage",
  "console.log",
  "console.error",
])

const requiredBranchNames = Object.freeze([
  "login allowed success",
  "profile-missing users",
  "suspended login",
  "deleted login",
  "wrong password",
  "external next",
  "duplicate login submit",
  "signup with an immediate session",
  "signup with a null session",
  "duplicate signup submit",
  "known and unknown reset emails",
  "duplicate reset submit",
  "missing marker",
  "tampered marker",
  "expired marker",
  "valid verified recovery marker",
  "replayed valid marker",
  "provider 502",
  "visible labels",
  "keyboard Tab Shift-Tab and Enter",
  "first invalid reset field",
  "200 percent zoom",
  "out of URL storage and console",
])

test("Todo 5 auth UI and focused browser coverage files exist", async () => {
  for (const filePath of [...authUiFiles, ...authSpecFiles, ...authHelperFiles]) {
    const stats = await stat(filePath)
    assert.equal(stats.isFile(), true, `${filePath} must be a file`)
  }
})

test("Todo 5 auth UI excludes deferred auth modes and browser leakage sinks", async () => {
  const source = await readJoined(authUiFiles)
  for (const pattern of forbiddenUiPatterns) {
    assert.equal(source.includes(pattern), false, `forbidden auth UI pattern: ${pattern}`)
  }
})

test("Todo 5 browser specs cover every requested auth acceptance branch by name", async () => {
  const source = await readJoined(splitAuthSpecFiles)
  for (const branchName of requiredBranchNames) {
    assert.equal(source.includes(branchName), true, `missing auth branch spec: ${branchName}`)
  }
})

test("Todo 5 auth forms command contract uses the canonical aggregator once", async () => {
  const aggregator = await readText(authFormsAggregator)
  const runner = await readText("tests/auth-ui-e2e/run-auth-forms.mjs")

  assert.deepEqual(readAggregatorImports(aggregator), [
    "./auth-accessibility-security.spec",
    "./auth-signup-reset.spec",
    "./auth-update-password.spec",
    "./auth-login.spec",
  ])
  assert.equal(runner.includes(authFormsAggregator), true)
  for (const splitSpecFile of splitAuthSpecFiles) {
    assert.equal(
      runner.includes(splitSpecFile),
      false,
      `runner must not target split spec directly: ${splitSpecFile}`,
    )
  }
})

test("Todo 5 Playwright raw output is external-only and fail-closed", async () => {
  const config = await readText("playwright.auth.config.ts")
  const runner = await readText("tests/auth-ui-e2e/run-auth-forms.mjs")
  const rawOutput = await readText("tests/auth-ui-e2e/raw-output.mjs")

  assert.equal(config.includes("SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR"), true)
  assert.equal(config.includes("Raw Playwright output must not be written"), true)
  assert.equal(config.includes(".omo/evidence/supabase-auth-ui-session-auth-outputs"), false)
  assert.equal(runner.includes("prepareRawPlaywrightOutputDir"), true)
  assert.equal(rawOutput.includes("0o700"), true)
  assert.equal(rawOutput.includes(".omo/evidence"), true)
})

test("Todo 5 auth UI, form specs, and helpers stay under 250 pure LOC", async () => {
  for (const filePath of [...authUiFiles, ...authSpecFiles, ...authHelperFiles]) {
    assert.ok((await pureLoc(filePath)) <= 250, `${filePath} exceeds 250 pure LOC`)
  }
})

test("signup maps provider signup failures to field-level recovery messages", async () => {
  const signup = await readText("components/auth/signup-form.tsx")
  const spec = await readText("tests/auth-ui-e2e/auth-signup-reset.spec.ts")

  assert.match(signup, /mapSignupProviderError/u)
  assert.match(signup, /code === "user_already_exists" \|\|\s+code === "email_exists"/u)
  assert.match(signup, /이미 가입된 이메일이에요/u)
  assert.match(signup, /code === "invalid_email"/u)
  assert.match(signup, /code === "weak_password"/u)
  assert.match(signup, /비밀번호는 8자 이상 16자 이하로 입력하면 돼요\./u)
  assert.match(spec, /signup maps duplicate provider email errors to the email field/u)
  assert.match(spec, /signup maps provider weak password errors to the password field/u)
})

test("signup explains missing Supabase configuration instead of blaming user input", async () => {
  const signup = await readText("components/auth/signup-form.tsx")

  assert.match(signup, /SupabaseConfigError/u)
  assert.match(signup, /회원가입 서버 연결이 준비되지 않았어요\. 잠시 후 다시 시도해요\./u)
})

test("Todo 5 auth scope has no TypeScript escape hatches or empty catches", async () => {
  const source = await readJoined([...authUiFiles, ...authSpecFiles, ...authHelperFiles])
  const banned = [
    /as any/,
    /as unknown/,
    /@ts-ignore/,
    /@ts-expect-error/,
    /\w+!\./,
    /catch\s*\{\s*\}/,
  ]
  for (const pattern of banned) {
    assert.equal(pattern.test(source), false, `banned TypeScript pattern: ${pattern}`)
  }
})

test("Todo 5 update-password submit observer records status without reading body", async () => {
  const source = await readText("tests/auth-ui-e2e/auth-update-password.spec.ts")
  const observer = readFunctionSource(source, "redactedSubmitResponseCapture")

  assert.match(observer, /const status = response\.status\(\)/)
  assert.equal(observer.includes("response.json("), false)
  assert.equal(observer.includes("response.text("), false)
  assert.equal(observer.includes("response.body"), false)
  assert.equal(observer.includes("await"), false)
  assert.equal(observer.includes("status === 200 ? null"), true)
  assert.equal(source.includes("readSubmitErrorCode"), false)
})

test("Todo 5 recovery diagnostic records route status without reading body", async () => {
  const source = await readText("tests/auth-ui-e2e/auth-recovery-diagnostic.spec.ts")
  const observer = readFunctionSource(source, "readRouteCapture")

  assert.match(observer, /const status = response\.status\(\)/)
  assert.equal(observer.includes("response.json("), false)
  assert.equal(observer.includes("response.text("), false)
  assert.equal(observer.includes("response.body"), false)
  assert.equal(observer.includes("await"), false)
  assert.equal(source.includes("readResponseErrorCode"), false)
})

async function readJoined(filePaths) {
  const parts = []
  for (const filePath of filePaths) parts.push(await readText(filePath))
  return parts.join("\n")
}

async function readText(filePath) {
  return readFile(filePath, "utf8")
}

function readAggregatorImports(source) {
  return source
    .split(/\n/)
    .map((line) => line.match(/^import "([^"]+)"$/)?.[1] ?? null)
    .filter((specifier) => specifier !== null)
}

async function pureLoc(filePath) {
  const text = await readText(filePath)
  return text.split(/\n/).filter((line) => {
    const trimmed = line.trim()
    return trimmed.length > 0 && !trimmed.startsWith("//") && !trimmed.startsWith("#")
  }).length
}

function readFunctionSource(source, functionName) {
  const declaration = `function ${functionName}`
  const start = source.indexOf(declaration)
  assert.notEqual(start, -1, `${functionName} must exist`)
  const nextFunction = source.indexOf("\nfunction ", start + declaration.length)
  return source.slice(start, nextFunction === -1 ? source.length : nextFunction)
}
