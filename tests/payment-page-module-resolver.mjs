import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import typescript from "typescript"

const workspaceUrl = pathToFileURL(`${process.cwd()}/`).href
const stubsUrl = new URL("./payment-page-runtime-stubs.mjs", import.meta.url).href

export function installPaymentPageModuleResolver() {
  registerHooks({
    load(url, context, nextLoad) {
      if (url.endsWith(".ts") || url.endsWith(".tsx")) {
        const loaded = nextLoad(url, { ...context, format: "module" })
        const source = typeof loaded.source === "string" ? loaded.source : loaded.source.toString()
        const result = typescript.transpileModule(source, {
          compilerOptions: {
            jsx: typescript.JsxEmit.ReactJSX,
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ES2022,
          },
          fileName: fileURLToPath(url),
        })
        return { format: "module", shortCircuit: true, source: result.outputText }
      }

      return nextLoad(url, context)
    },
    resolve(specifier, context, nextResolve) {
      if (
        specifier === "next/link" ||
        specifier === "next/navigation" ||
        specifier === "@/components/layout/public-header" ||
        specifier === "@/lib/payments/payment-prepare-client" ||
        (specifier === "react" && context.parentURL?.endsWith("payment-preparation-form.tsx"))
      ) {
        return nextResolve(stubsUrl, context)
      }

      const baseUrl = specifier.startsWith("@/")
        ? new URL(specifier.slice(2), workspaceUrl)
        : context.parentURL && specifier.startsWith(".")
          ? new URL(specifier, context.parentURL)
          : null

      if (baseUrl) {
        for (const extension of [".ts", ".tsx"]) {
          const candidate = new URL(`${baseUrl.href}${extension}`)
          if (existsSync(fileURLToPath(candidate))) {
            return nextResolve(candidate.href, context)
          }
        }
      }

      return nextResolve(specifier, context)
    },
  })
}
