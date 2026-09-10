import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { parseArgs } from "node:util"

import { chromium, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { writeSafeEvidence } from "./contract.mjs"

const { values } = parseArgs({
  options: {
    "base-url": { type: "string" },
    "mailbox-provider": { type: "string", default: "mailtrap" },
    output: { type: "string", default: ".omo/evidence/staging/task-5-smtp-auth.json" },
  },
})
const baseUrl = values["base-url"] ?? process.env.SPOLINK_STAGING_BASE_URL
if (!baseUrl || new URL(baseUrl).protocol !== "https:") throw new Error("https-base-url-required")
if (values["mailbox-provider"] !== "mailtrap") throw new Error("unsupported-mailbox-provider")

const email = `spolink-staging-${randomUUID()}@example.com`
const createdMessageIds = new Set()
let browser
let serviceClient
let messagesUrl
let mailtrapHeaders

function readSecret(envName, service, account) {
  const fromEnvironment = process.env[envName]?.trim()
  if (fromEnvironment) return fromEnvironment
  if (process.platform !== "darwin") throw new Error(`missing-secret-${envName}`)
  return execFileSync("security", ["find-generic-password", "-s", service, "-a", account, "-w"], {
    encoding: "utf8",
  }).trim()
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`provider-request-${response.status}`)
  return body
}

async function requestText(url, init = {}) {
  const response = await fetch(url, init)
  const body = await response.text()
  if (!response.ok) throw new Error(`provider-request-${response.status}`)
  return body
}

function readSupabaseProjectRef() {
  if (process.env.SUPABASE_PROJECT_ID) return process.env.SUPABASE_PROJECT_ID
  const output = execFileSync(
    "corepack",
    ["pnpm", "exec", "supabase", "projects", "list", "-o", "json"],
    { encoding: "utf8" },
  )
  const parsed = JSON.parse(output)
  const project = (parsed.projects ?? parsed).find((value) => value.name === "spolink-staging")
  const projectRef = project?.ref ?? project?.id
  if (!projectRef) throw new Error("supabase-staging-project-missing")
  return projectRef
}

function readServiceRole(projectRef) {
  if (process.env.SPOLINK_STAGING_SUPABASE_SERVICE_ROLE_KEY) {
    return process.env.SPOLINK_STAGING_SUPABASE_SERVICE_ROLE_KEY
  }
  const output = execFileSync(
    "corepack",
    ["pnpm", "exec", "supabase", "projects", "api-keys", "--project-ref", projectRef, "-o", "json"],
    { encoding: "utf8" },
  )
  const parsed = JSON.parse(output)
  const keys = Array.isArray(parsed) ? parsed : (parsed.api_keys ?? parsed.keys ?? [])
  const serviceRole = keys
    .filter((key) => key.name === "service_role")
    .map((key) => key.api_key ?? key.key ?? key.value)
    .find(Boolean)
  if (!serviceRole) throw new Error("supabase-service-role-missing")
  return serviceRole
}

async function loadMailbox() {
  const token = readSecret(
    "SPOLINK_STAGING_MAILTRAP_API_TOKEN",
    "spolink-mailtrap-staging",
    "api-token",
  )
  mailtrapHeaders = { "Api-Token": token }
  const accounts = await requestJson("https://mailtrap.io/api/accounts", {
    headers: mailtrapHeaders,
  })
  const account = accounts.find((value) =>
    (value.access_levels ?? []).some((level) => level >= 100),
  )
  if (!account) throw new Error("mailtrap-admin-account-missing")
  const projects = await requestJson(`https://mailtrap.io/api/accounts/${account.id}/projects`, {
    headers: mailtrapHeaders,
  })
  const inbox = projects.flatMap((project) => project.inboxes ?? [])[0]
  if (!inbox?.id) throw new Error("mailtrap-inbox-missing")
  messagesUrl = `https://mailtrap.io/api/accounts/${account.id}/inboxes/${inbox.id}/messages`
  return { accountId: account.id, inboxId: inbox.id }
}

async function waitForNewMessage(excludedIds) {
  let found
  await expect
    .poll(
      async () => {
        const messages = await requestJson(messagesUrl, { headers: mailtrapHeaders })
        found = messages.find((message) => !excludedIds.has(message.id))
        return Boolean(found)
      },
      { timeout: 30_000, intervals: [250, 500, 1_000, 2_000] },
    )
    .toBe(true)
  return found
}

async function readAuthLink(message, mailbox, context) {
  const detail = await requestJson(
    `https://mailtrap.io/api/accounts/${mailbox.accountId}/inboxes/${mailbox.inboxId}/messages/${message.id}`,
    { headers: mailtrapHeaders },
  )
  const htmlPath = detail.html_path ?? detail.html_source_path ?? message.html_path
  if (!htmlPath) throw new Error("mailtrap-html-path-missing")
  const html = await requestText(new URL(htmlPath, "https://mailtrap.io"), {
    headers: mailtrapHeaders,
  })
  const parser = await context.newPage()
  try {
    await parser.setContent(html)
    const links = await parser
      .locator("a[href]")
      .evaluateAll((anchors) => anchors.map((anchor) => anchor.href))
    const authLink = links.find((href) => new URL(href).pathname === "/auth/v1/verify")
    if (!authLink) throw new Error("auth-link-missing")
    return authLink
  } finally {
    await parser.close()
  }
}

async function cleanup() {
  let deletedMessages = 0
  for (const messageId of createdMessageIds) {
    const response = await fetch(`${messagesUrl}/${messageId}`, {
      method: "DELETE",
      headers: mailtrapHeaders,
    })
    if (!response.ok) throw new Error(`mailtrap-cleanup-${response.status}`)
    deletedMessages += 1
  }
  let deletedUsers = 0
  if (serviceClient) {
    const listed = await serviceClient.auth.admin.listUsers({ page: 1, perPage: 1_000 })
    const user = listed.data.users.find((value) => value.email === email)
    if (user) {
      const deleted = await serviceClient.auth.admin.deleteUser(user.id)
      if (deleted.error) throw new Error("supabase-user-cleanup-failed")
      deletedUsers = 1
    }
  }
  return { deletedMessages, deletedUsers }
}

async function run() {
  const mailbox = await loadMailbox()
  const baseline = await requestJson(messagesUrl, { headers: mailtrapHeaders })
  const baselineIds = new Set(baseline.map((message) => message.id))
  const projectRef = readSupabaseProjectRef()
  serviceClient = createClient(`https://${projectRef}.supabase.co`, readServiceRole(projectRef), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  browser = await chromium.launch({ headless: process.env.SPOLINK_STAGING_HEADED === "0" })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const pageErrors = []
  const requestFailures = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("requestfailed", (request) =>
    requestFailures.push(request.failure()?.errorText ?? "failed"),
  )

  await page.goto(`${baseUrl}/auth/signup`)
  await page.getByLabel("이메일").fill(email)
  await page.getByLabel("비밀번호", { exact: true }).fill("Sp0link!1234")
  await page.getByLabel("비밀번호 확인").fill("Sp0link!1234")
  await page.getByRole("button", { name: "계정 만들기" }).click()
  await expect(page).toHaveURL(`${baseUrl}/auth/check-email`, { timeout: 30_000 })

  const confirmation = await waitForNewMessage(baselineIds)
  createdMessageIds.add(confirmation.id)
  await page.goto(await readAuthLink(confirmation, mailbox, context))
  await expect(page).toHaveURL(`${baseUrl}/onboarding/profile`, { timeout: 30_000 })
  await context.clearCookies()
  await new Promise((resolve) => setTimeout(resolve, 1_100))

  await page.goto(`${baseUrl}/auth/reset-password`)
  await page.getByLabel("이메일").fill(email)
  await page.getByRole("button", { name: "재설정 안내 받기" }).click()
  const recovery = await waitForNewMessage(new Set([...baselineIds, ...createdMessageIds]))
  createdMessageIds.add(recovery.id)
  const recoveryLink = await readAuthLink(recovery, mailbox, context)
  await page.goto(recoveryLink)
  await expect(page).toHaveURL(`${baseUrl}/auth/update-password`, { timeout: 30_000 })
  await page.getByLabel("새 비밀번호", { exact: true }).fill("Sp0link!5678")
  await page.getByLabel("새 비밀번호 확인").fill("Sp0link!5678")
  await page.getByRole("button", { name: "비밀번호 변경" }).click()
  await expect(page).toHaveURL(`${baseUrl}/onboarding/profile`, { timeout: 30_000 })
  await page.goto(recoveryLink)
  await expect(page).not.toHaveURL(`${baseUrl}/auth/update-password`)

  const unexpectedFailures = requestFailures.filter((failure) => failure !== "net::ERR_ABORTED")
  const cleanupResult = await cleanup()
  const evidence = {
    schemaVersion: 1,
    case: "smtp-auth-flow",
    verdict: pageErrors.length === 0 && unexpectedFailures.length === 0 ? "APPROVE" : "REJECT",
    scenarios: {
      signupConfirmationReceived: true,
      confirmationCallbackAccepted: true,
      recoveryEmailReceived: true,
      passwordUpdateAccepted: true,
      recoveryReplayRejected: true,
    },
    browser: {
      pageErrorCount: pageErrors.length,
      unexpectedRequestFailureCount: unexpectedFailures.length,
    },
    cleanup: cleanupResult,
  }
  await writeSafeEvidence(values.output, evidence)
  console.log(JSON.stringify(evidence, null, 2))
}

run()
  .catch(async (error) => {
    await cleanup().catch(() => {})
    console.error(error instanceof Error ? error.message : "unknown-error")
    process.exitCode = 1
  })
  .finally(async () => {
    await browser?.close()
  })
