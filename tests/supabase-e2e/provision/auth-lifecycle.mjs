import { createHash, randomBytes } from "node:crypto"

import { fixtureEmails, fixtureUsers } from "../fixtures.mjs"

export function generateRunPassword() {
  return `Spolink-${randomBytes(24).toString("base64url")}-1a!`
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

export async function listFixtureAuthUsers(serviceClient) {
  const matched = []
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw error
    const users = data?.users ?? []
    matched.push(...users.filter((user) => fixtureEmails.includes(user.email)))
    if (users.length < 100) break
  }
  return matched
}

export async function createFixtureAuthUsers(serviceClient, password) {
  const authIds = {}
  for (const fixture of fixtureUsers) {
    const { data, error } = await serviceClient.auth.admin.createUser({
      email: fixture.email,
      password,
      email_confirm: true,
    })
    if (error) throw error
    if (!data.user?.id) throw new Error(`GoTrue did not return an id for ${fixture.key}`)
    authIds[fixture.key] = data.user.id
  }
  return authIds
}

export async function assertSignIns(anonClient, password) {
  for (const fixture of fixtureUsers) {
    const { data, error } = await anonClient.auth.signInWithPassword({
      email: fixture.email,
      password,
    })
    if (error) throw error
    if (!data.user?.id) throw new Error(`Sign-in did not return a user for ${fixture.key}`)
    await anonClient.auth.signOut()
  }
}
