import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createElement } from "react"
import typescript from "typescript"

import { inspectRenderedHtml } from "../react-html-runtime.mjs"

const workspaceUrl = pathToFileURL(`${process.cwd()}/`).href
const nextImageStub = `
const createElement = globalThis[Symbol.for("spolink.lesson-image-manager.create-element")]
export default function Image({ fill, unoptimized, ...props }) {
  return createElement("img", props)
}`

globalThis[Symbol.for("spolink.lesson-image-manager.create-element")] = createElement

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
    if (specifier === "next/image") {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(nextImageStub)}`,
      }
    }
    const baseUrl = specifier.startsWith("@/")
      ? new URL(specifier.slice(2), workspaceUrl)
      : context.parentURL && specifier.startsWith(".")
        ? new URL(specifier, context.parentURL)
        : null

    if (baseUrl) {
      for (const extension of [".ts", ".tsx"]) {
        const candidate = new URL(`${baseUrl.href}${extension}`)
        if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context)
      }
    }

    return nextResolve(specifier, context)
  },
})

const manager = await import("../../components/lessons/lesson-image-manager.tsx")

const existing = (id, status = "registered") => ({
  id,
  kind: "existing",
  previewUrl: `https://images.example.test/${id}.jpg`,
  status,
})

const queued = (id, file, status = "queued", errorMessage) => ({
  errorMessage,
  file,
  id,
  kind: "queued",
  status,
})

const imageFile = (name, type = "image/png", size = 12) => ({ name, size, type })

test("Given an exact 5 MiB image, when selection is validated, then it remains accepted", () => {
  assert.equal(manager.LESSON_IMAGE_MANAGER_MAX_BYTES, 5 * 1024 * 1024)
  assert.deepEqual(
    manager.validateLessonImageSelection({
      currentItemCount: 2,
      files: [
        imageFile("exact.png", "image/png", manager.LESSON_IMAGE_MANAGER_MAX_BYTES),
        imageFile("photo.webp", "image/webp"),
      ],
    }),
    {
      files: [
        imageFile("exact.png", "image/png", manager.LESSON_IMAGE_MANAGER_MAX_BYTES),
        imageFile("photo.webp", "image/webp"),
      ],
      status: "success",
    },
  )
})

for (const scenario of [
  {
    input: { currentItemCount: 0, files: [imageFile("empty.png", "image/png", 0)] },
    name: "a zero-byte image",
  },
  {
    input: {
      currentItemCount: 0,
      files: [imageFile("large.png", "image/png", manager.LESSON_IMAGE_MANAGER_MAX_BYTES + 1)],
    },
    name: "an image one byte over 5 MiB",
  },
  {
    input: { currentItemCount: 0, files: [imageFile("wrong.gif", "image/gif")] },
    name: "an invalid MIME type",
  },
  {
    input: { currentItemCount: 4, files: [imageFile("five.png"), imageFile("six.png")] },
    name: "a sixth image across mixed state",
  },
]) {
  test(`Given ${scenario.name}, when selection is validated, then it is rejected`, () => {
    assert.equal(manager.validateLessonImageSelection(scenario.input).status, "error")
  })
}

test("Given mixed registered and queued images, when order changes, then cover and selection order remain deterministic", () => {
  const items = [
    existing("one"),
    queued("two", imageFile("two.png")),
    queued("three", imageFile("three.png")),
  ]

  assert.deepEqual(
    manager.moveLessonImageManagerItem(items, "three", 0).map((item) => item.id),
    ["three", "one", "two"],
  )
  assert.deepEqual(
    manager.moveLessonImageManagerItem(items, "one", 2).map((item) => item.id),
    ["two", "three", "one"],
  )
})

test("Given local preview lifecycle changes, when an item is removed, replaced, or unmounted, then every created URL is revoked", () => {
  const created = []
  const revoked = []
  const previews = new manager.LessonImagePreviewRegistry({
    createObjectURL(file) {
      const url = `blob:${file.name}:${created.length}`
      created.push(url)
      return url
    },
    revokeObjectURL(url) {
      revoked.push(url)
    },
  })
  const original = imageFile("one.png")
  const replacement = imageFile("replacement.png")

  previews.reconcile([queued("one", original)])
  previews.reconcile([queued("one", replacement)])
  previews.reconcile([])
  previews.reconcile([queued("two", imageFile("two.png"))])
  previews.dispose()

  assert.deepEqual(created, ["blob:one.png:0", "blob:replacement.png:1", "blob:two.png:2"])
  assert.deepEqual(revoked, created)
})

test("Given manager states, when rendered, then keyboard controls, live status, alert handling, and read-only state are exposed", async () => {
  const failed = queued("failed", imageFile("failed.png"), "failed", "업로드를 다시 시도해 주세요.")
  const items = [existing("registered"), failed, existing("deleting", "deleting")]
  const callbacks = {
    onDeleteExistingImage: async () => ({ status: "success" }),
    onQueueFiles() {},
    onRemoveQueuedImage() {},
    onReorderItems() {},
    onRetryQueuedImage() {},
    onUploadQueuedImage() {},
  }

  await inspectRenderedHtml(
    createElement(manager.LessonImageManager, { ...callbacks, items }),
    async ({ page }) => {
      assert.equal(await page.getByText("대표 이미지").count(), 1)
      assert.equal((await page.getByRole("status").count()) >= 1, true)
      assert.equal(await page.getByRole("alert").count(), 1)
      assert.equal((await page.getByLabel("이미지 순서 앞당기기").count()) >= 1, true)
      assert.equal((await page.getByLabel("대표 이미지로 설정").count()) >= 1, true)
      assert.equal((await page.getByLabel("이미지 삭제").count()) >= 1, true)
      assert.equal(await page.getByLabel("업로드 다시 시도").count(), 1)
      assert.equal(
        await page.locator('input[type="file"]').getAttribute("accept"),
        "image/jpeg,image/png,image/webp",
      )
    },
  )

  await inspectRenderedHtml(
    createElement(manager.LessonImageManager, { ...callbacks, disabled: true, items }),
    async ({ page }) => {
      assert.equal(await page.getByLabel("레슨 이미지 추가").isDisabled(), true)
      assert.equal(await page.getByLabel("이미지 삭제").count(), 0)
      assert.equal(await page.getByLabel("업로드 다시 시도").count(), 0)
      assert.equal(await page.getByText("등록됨").count(), 1)
      assert.equal(await page.getByText("삭제 중").count(), 1)
    },
  )
})
