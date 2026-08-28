import assert from "node:assert/strict"
import { chmod, writeFile } from "node:fs/promises"

export async function createQaUser(service, email, password) {
  const result = await service.auth.admin.createUser({ email, email_confirm: true, password })
  if (result.error || !result.data.user) throw result.error ?? new Error("Auth user missing")
  return result.data.user.id
}

export async function loginQaPage(page, email, password, next) {
  await page.goto(`/auth/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel("이메일").fill(email)
  await page.getByLabel("비밀번호").fill(password)
  await page.getByRole("button", { name: "로그인" }).click()
  await page.waitForURL(/\/lessons$/u)
  await page.goto(next)
  assert.equal(new URL(page.url()).pathname, next)
}

export async function writePrivateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await chmod(path, 0o600)
}
