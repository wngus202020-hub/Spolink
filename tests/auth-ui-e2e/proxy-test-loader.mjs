import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import { NextResponse } from "next/server.js"
import ts from "typescript"

const rootProxyPath = `${process.cwd()}/proxy.ts`
const proxyClientPath = `${process.cwd()}/lib/supabase/proxy.ts`

export async function withLoadedProxy(callback) {
  const tempDir = await mkdtemp(join(process.cwd(), ".omo/evidence/.tmp-spolink-proxy-test-"))
  globalThis.__spolinkRootProxy = {
    getConfigStatus() {
      return { configured: true, invalidKeys: [], missingKeys: [] }
    },
    async refreshSession() {
      return new NextResponse(null, { headers: { "x-spolink-refreshed": "1" } })
    },
  }
  globalThis.__spolinkSupabaseProxy = {
    createServerClient() {
      throw new Error("default createServerClient must not run in injected tests")
    },
    readEnv() {
      return {
        supabaseAnonKey: "anon-key",
        supabaseUrl: "https://supabase.spolink.test",
      }
    },
  }

  try {
    const rootProxyModule = await importTranspiledProductionModule(rootProxyPath, tempDir)
    const proxyClientModule = await importTranspiledProductionModule(proxyClientPath, tempDir)
    await callback({ proxyClientModule, rootProxyModule })
  } finally {
    Reflect.deleteProperty(globalThis, "__spolinkRootProxy")
    Reflect.deleteProperty(globalThis, "__spolinkSupabaseProxy")
    await rm(tempDir, { force: true, recursive: true })
  }
}

async function importTranspiledProductionModule(sourcePath, tempDir) {
  const source = await readFile(sourcePath, "utf8")
  const transpiled = ts.transpileModule(rewriteProductionImports(source, sourcePath), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: sourcePath,
  })
  const outputPath = join(
    tempDir,
    `${basename(sourcePath, ".ts")}-${Buffer.from(sourcePath).toString("hex")}.mjs`,
  )

  await writeFile(outputPath, transpiled.outputText, { mode: 0o600 })

  return import(pathToFileURL(outputPath).href)
}

function rewriteProductionImports(source, sourcePath) {
  let output = source

  for (const [from, to] of productionImportRewrites.get(sourcePath) ?? []) {
    output = output.replace(from, to)
  }

  return output
}

const productionImportRewrites = new Map([
  [
    rootProxyPath,
    [
      [
        'import { type NextRequest, NextResponse } from "next/server"',
        'import { NextResponse } from "next/server.js"',
      ],
      [
        'import { getSupabaseConfigStatus } from "@/lib/supabase/env"',
        "const getSupabaseConfigStatus = globalThis.__spolinkRootProxy.getConfigStatus",
      ],
      [
        'import { refreshSupabaseSessionInProxy } from "@/lib/supabase/proxy"',
        "const refreshSupabaseSessionInProxy = globalThis.__spolinkRootProxy.refreshSession",
      ],
      ['import type { SupabaseConfigStatus } from "@/lib/supabase/env"', ""],
    ],
  ],
  [
    proxyClientPath,
    [
      [
        'import { createServerClient } from "@supabase/ssr"',
        "const createServerClient = globalThis.__spolinkSupabaseProxy.createServerClient",
      ],
      [
        'import { type NextRequest, NextResponse } from "next/server"',
        'import { NextResponse } from "next/server.js"',
      ],
      [
        'import { readSupabasePublicEnv, type SupabasePublicEnv } from "@/lib/supabase/env"',
        "const readSupabasePublicEnv = globalThis.__spolinkSupabaseProxy.readEnv",
      ],
    ],
  ],
])
