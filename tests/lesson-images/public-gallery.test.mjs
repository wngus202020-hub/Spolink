import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import typescript from "typescript"

const projectRootUrl = pathToFileURL(`${process.cwd()}/`)

registerHooks({
  load(url, context, nextLoad) {
    if (new URL(url).pathname.endsWith(".tsx")) {
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
    if (specifier === "next/image") {
      return nextResolve(new URL("./next-image-stub.mjs", import.meta.url).href, context)
    }

    if (specifier.startsWith("@/")) {
      const baseUrl = new URL(specifier.slice(2), projectRootUrl)
      const candidate = new URL(`${baseUrl.href}.tsx`)

      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context)
    }

    return nextResolve(specifier, context)
  },
})

const { LessonDetailGallery } = await import("../../components/lessons/lesson-detail-gallery.tsx")

const title = "강남 테니스 기초 레슨"
const images = Array.from({ length: 5 }, (_, index) => ({
  sortOrder: index,
  url: `https://example.test/storage/v1/object/public/lesson-images/lesson/image-${index + 1}.webp`,
}))

test("Given five ordered public images, when the detail gallery renders, then it exposes the first primary image and all ordered thumbnail controls", () => {
  const markup = renderToStaticMarkup(createElement(LessonDetailGallery, { images, title }))

  assert.match(markup, /data-lesson-gallery-primary="true"/u)
  assert.match(markup, new RegExp(`alt="${title} 이미지 1/5"`, "u"))
  assert.equal((markup.match(/data-lesson-gallery-thumbnail=/gu) ?? []).length, 5)

  for (const [index, image] of images.entries()) {
    assert.match(markup, new RegExp(`data-lesson-gallery-thumbnail="${index}"`, "u"))
    assert.match(markup, new RegExp(image.url.replaceAll("/", "\\/"), "u"))
  }
})

test("Given zero or one public image, when the detail gallery renders, then it keeps the missing fallback and omits empty controls", () => {
  const missingMarkup = renderToStaticMarkup(
    createElement(LessonDetailGallery, { images: [], title }),
  )
  const singleMarkup = renderToStaticMarkup(
    createElement(LessonDetailGallery, { images: [images[0]], title }),
  )

  assert.match(missingMarkup, /대표 이미지 준비 중/u)
  assert.match(missingMarkup, /aspect-\[4\/3\] lg:aspect-\[16\/9\]/u)
  assert.equal(missingMarkup.includes("data-lesson-gallery-thumbnail"), false)
  assert.match(singleMarkup, /data-lesson-gallery-primary="true"/u)
  assert.equal(singleMarkup.includes("data-lesson-gallery-thumbnail"), false)
})
