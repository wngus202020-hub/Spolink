const defaultMaxChecks = 200

export async function convergeOwnedExpiredIntent(
  dependencies,
  { maxChecks = defaultMaxChecks, wait = waitForPeer } = {},
) {
  const aggregate = { claimed: 0, cleaned: 0, failed: 0 }
  for (let check = 1; check <= maxChecks; check += 1) {
    const state = await dependencies.readState()
    if (state.intentStatus === "cleaned" && state.objectExists === false) {
      return { ...aggregate, checks: check }
    }
    if (state.intentStatus === "claimed") {
      await wait()
      continue
    }
    const batch = await dependencies.runBatch()
    aggregate.claimed += batch.claimed
    aggregate.cleaned += batch.cleaned
    aggregate.failed += batch.failed
    if (batch.failed !== 0) throw new Error("Expired image cleanup batch failed")
  }
  throw new Error("Owned expired image intent did not converge")
}

function waitForPeer() {
  return new Promise((resolve) => setTimeout(resolve, 25))
}
