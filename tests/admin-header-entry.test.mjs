import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import typescript from "typescript"

const workspaceUrl = pathToFileURL(`${process.cwd()}/`).href
const linkFactorySymbol = Symbol.for("spolink.admin-header-entry.create-element")

globalThis[linkFactorySymbol] = createElement

const nextLinkStub = `
const createElement = globalThis[Symbol.for("spolink.admin-header-entry.create-element")]
export default function Link({ children, ...props }) {
  return createElement("a", props, children)
}`

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
    if (specifier === "next/link") {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(nextLinkStub)}`,
      }
    }

    if (specifier.startsWith("@/")) {
      const baseUrl = new URL(specifier.slice(2), workspaceUrl)
      for (const extension of [".ts", ".tsx"]) {
        const candidate = new URL(`${baseUrl.href}${extension}`)
        if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context)
      }
    }

    return nextResolve(specifier, context)
  },
})

const { PublicHeader } = await import("../components/layout/public-header.tsx")

const roles = ["admin", "coach", "learner"]
const statuses = ["active", "coach_approved", "deleted", "pending_coach", "suspended"]

function renderHeader(auth) {
  const markup = renderToStaticMarkup(createElement(PublicHeader, { auth }))
  const links = [...markup.matchAll(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gu)].map(
    ([, href, contents]) => ({
      href,
      label: contents.replace(/<[^>]+>/gu, "").trim(),
    }),
  )

  return { links, markup }
}

function readyAuth(role, status) {
  return {
    coachProfile: null,
    kind: "ready",
    profile: {
      display_name: "표시 이름",
      role,
      status,
    },
  }
}

test("Given an active administrator, when the public header renders, then 관리자 is exactly once immediately before 마이", () => {
  const { links, markup } = renderHeader(readyAuth("admin", "active"))
  const adminLinks = links.filter((link) => link.href === "/admin")
  const myPageIndex = links.findIndex((link) => link.href === "/mypage")

  assert.deepEqual(adminLinks, [{ href: "/admin", label: "관리자" }])
  assert.equal(links[myPageIndex - 1]?.label, "관리자")
  assert.equal(links[myPageIndex]?.label, "마이")
  assert.match(markup, /표시 이름/u)
  assert.match(markup, /로그아웃/u)
  assert.match(markup, /flex-wrap/u)
  assert.equal((markup.match(/min-h-11/gu) ?? []).length >= 5, true)
})

test("Given every non-active-admin account state, when the public header renders, then no /admin entry appears", (t) => {
  const nonReadyStates = [
    { kind: "unconfigured" },
    { kind: "unauthenticated" },
    { kind: "profile_required", userId: "redacted" },
  ]

  for (const auth of nonReadyStates) {
    t.test(auth.kind, () => {
      assert.equal(renderHeader(auth).links.filter((link) => link.href === "/admin").length, 0)
    })
  }

  for (const role of roles) {
    for (const status of statuses) {
      if (role === "admin" && status === "active") continue
      t.test(`${role}-${status}`, () => {
        assert.equal(
          renderHeader(readyAuth(role, status)).links.filter((link) => link.href === "/admin")
            .length,
          0,
        )
      })
    }
  }
})
