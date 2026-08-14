import { fixedIds, fixtureUsers } from "../fixtures.mjs"
import { createLearnerCookieJar } from "../ssr-cookie-jar.mjs"
import { assertQaState } from "./qa-db.mjs"
import { beginQaProof, recordDbProof, recordHttpProof } from "./qa-proof.mjs"

export async function runInternalQa(context) {
  await beginQaProof()
  const configResponse = await fetch(`${context.configured.baseUrl}/api/config/supabase`)
  const configBody = await configResponse.json()
  if (configResponse.status !== 200) {
    throw new Error(`Expected configured 200, got ${configResponse.status}`)
  }
  await recordHttpProof("configured", configResponse.status, configBody)
  const response = await fetch(
    `${context.configured.baseUrl}/api/reservations/${fixedIds.cancellableReservation}/cancel`,
    {
      body: JSON.stringify({ reason: "Todo8 internal QA" }),
      headers: {
        "content-type": "application/json",
        origin: new URL(context.configured.baseUrl).origin,
      },
      method: "POST",
    },
  )
  if (response.status !== 401)
    throw new Error(`Expected unauthenticated 401, got ${response.status}`)
  const unauthBody = await response.json()
  await recordHttpProof("unauthorized", response.status, unauthBody)
  await recordDbProof("pristine", await assertQaState("pristine"))
  const user = fixtureUsers.find((candidate) => candidate.key === "learner")
  const jar = await createLearnerCookieJar({
    email: user.email,
    password: context.qaProvision.runPassword,
    status: context.status,
  })
  const authResponse = await fetch(
    `${context.configured.baseUrl}/api/reservations/${fixedIds.cancellableReservation}/cancel`,
    {
      body: JSON.stringify({ reason: "Todo8 internal QA" }),
      headers: {
        cookie: jar.cookieHeader(),
        "content-type": "application/json",
        origin: new URL(context.configured.baseUrl).origin,
      },
      method: "POST",
    },
  )
  const body = await authResponse.json()
  if (authResponse.status !== 200)
    throw new Error(`Expected authenticated 200, got ${authResponse.status}`)
  await recordHttpProof("cancellation", authResponse.status, body)
  await recordDbProof("cancelled", await assertQaState("cancelled", body, "Todo8 internal QA"))
}
