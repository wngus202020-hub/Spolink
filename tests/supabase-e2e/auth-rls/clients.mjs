import { createClient } from "@supabase/supabase-js"

import { fixtureUsers } from "../fixtures.mjs"

const personaKeys = ["learner", "otherLearner", "coach", "pendingCoach", "admin"]

export function createPersonaClients(status) {
  const clients = {
    anonymous: createBrowserLikeClient(status),
  }
  for (const key of personaKeys) {
    clients[key] = createBrowserLikeClient(status)
  }
  return clients
}

export async function signInPersonas(clients, password) {
  for (const key of personaKeys) {
    const email = fixtureUsers.find((user) => user.key === key)?.email
    if (!email) throw new Error(`Missing fixture email for persona: ${key}`)
    const { data, error } = await clients[key].auth.signInWithPassword({ email, password })
    if (error) throw error
    if (!data.user?.id) throw new Error(`Sign-in did not return user id for persona: ${key}`)
  }
}

export async function signOutPersonas(clients) {
  for (const client of Object.values(clients)) {
    await client.auth.signOut()
  }
}

function createBrowserLikeClient(status) {
  return createClient(status.apiUrl, status.anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
}
