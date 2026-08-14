import { register } from "node:module"

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      try {
        return await nextResolve(specifier, context)
      } catch (error) {
        if (error && error.code === "ERR_MODULE_NOT_FOUND" && /^(?:\\.\\.?\\/)/.test(specifier)) {
          return nextResolve(specifier + ".ts", context)
        }
        throw error
      }
    }
  `)}`,
  import.meta.url,
)

await import("./profile-api/repository-boundary.test.mjs")
await import("./profile-api/validation.test.mjs")
await import("./profile-api/route-handlers.test.mjs")
