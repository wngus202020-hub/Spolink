import { expect, type Locator } from "@playwright/test"

export async function expectVisibleFocus(locator: Locator) {
  const visible = await locator.evaluate((element) => {
    const style = getComputedStyle(element)
    return (
      (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 2) ||
      style.boxShadow !== "none"
    )
  })
  expect(visible, "focused control has a visible indicator").toBe(true)
}

export async function expectTextContrast(locator: Locator, minimum: number, description: string) {
  const ratio = await locator.evaluate((element) => {
    const parse = (value: string) =>
      value
        .match(/[\d.]+/gu)
        ?.slice(0, 3)
        .map(Number) ?? []
    const luminance = (rgb: number[]) => {
      const channels = rgb.map((value) => {
        const normalized = value / 255
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0)
    }
    const foreground = luminance(parse(getComputedStyle(element).color))
    let backgroundElement: Element | null = element
    let backgroundColor = ""
    while (backgroundElement) {
      const candidate = getComputedStyle(backgroundElement).backgroundColor
      if (candidate !== "rgba(0, 0, 0, 0)" && candidate !== "transparent") {
        backgroundColor = candidate
        break
      }
      backgroundElement = backgroundElement.parentElement
    }
    const background = luminance(parse(backgroundColor || "rgb(255, 255, 255)"))
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
  })
  expect(ratio, `${description} contrast ratio`).toBeGreaterThanOrEqual(minimum)
}
