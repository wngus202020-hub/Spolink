import { register } from "node:module"
import { pathToFileURL } from "node:url"

const repoUrl = pathToFileURL(`${process.cwd()}/`).href
const serverOnlyUrl = `data:text/javascript,${encodeURIComponent("export {}")}`

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { shortCircuit: true, url: "${serverOnlyUrl}" };
      if (specifier === "next/server") return nextResolve("next/server.js", context);
      if (specifier === "next/headers") return nextResolve("next/headers.js", context);
      if (specifier.startsWith("@/")) return nextResolve("${repoUrl}" + specifier.slice(2) + ".ts", context);
      return nextResolve(specifier, context);
    }
  `)}`,
  import.meta.url,
)

await import("./session-token-cookie.test-cases.mjs")
await import("./session-route-flow.test-cases.mjs")
await import("./session-update-flow.test-cases.mjs")
