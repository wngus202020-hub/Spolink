import { registerHooks } from "node:module"

const cliUrl = new URL("../rpc-boundary-security.mjs", import.meta.url).href
const fixtureUrl = new URL("./scenario-fixture.mjs", import.meta.url).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === cliUrl && specifier === "../rpc-boundary-security.mjs") {
      return { shortCircuit: true, url: fixtureUrl }
    }
    return nextResolve(specifier, context)
  },
})
