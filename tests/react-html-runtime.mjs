import { open, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { chromium } from "@playwright/test"
import { renderToStaticMarkup } from "react-dom/server"

export async function inspectRenderedHtml(element, inspect) {
  return withBrowserSlot(async () => {
    const markup = renderToStaticMarkup(element)
    const browser = await chromium.launch({ timeout: 30_000 })
    const page = await browser.newPage()
    try {
      page.setDefaultTimeout(10_000)
      await page.setContent(markup)
      return await inspect({ markup, page })
    } finally {
      await page.close()
      await browser.close()
    }
  })
}

export async function readLinkContract(page) {
  return await page.getByRole("link").evaluateAll((links) =>
    links.map((link) => ({
      href: link.getAttribute("href"),
      label: link.textContent?.replace(/\s+/gu, " ").trim() ?? "",
    })),
  )
}

async function withBrowserSlot(action) {
  const lockPath = path.join(tmpdir(), `spolink-react-html-${process.ppid}.lock`)
  const deadline = Date.now() + 30_000
  let lock
  while (!lock) {
    try {
      lock = await open(lockPath, "wx", 0o600)
      await lock.writeFile(String(process.pid))
    } catch (error) {
      if (error?.code !== "EEXIST") throw error
      if (Date.now() >= deadline) throw new Error("Timed out waiting for the HTML browser slot")
      await delay(25)
    }
  }
  try {
    return await action()
  } finally {
    await lock.close()
    await unlink(lockPath)
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
