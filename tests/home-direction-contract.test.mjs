import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("light action tokens expose exact accessible runtime values", async () => {
  // Given: CSS custom properties consumed by public action controls.
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8")
  const lightTheme = css.slice(
    css.indexOf(":root"),
    css.indexOf("@media (prefers-color-scheme: dark)"),
  )

  // When: machine-consumed action tokens are parsed from the light theme.
  const values = Object.fromEntries(
    [
      ...lightTheme.matchAll(
        /(--(?:accent-(?:primary|hover|pressed)|text-on-accent)):\s*(#[\da-f]{6});/giu,
      ),
    ].map(([, token, value]) => [token, value.toLowerCase()]),
  )

  // Then: each state is exact and readable against its foreground.
  assert.deepEqual(values, {
    "--accent-hover": "#d93b45",
    "--accent-pressed": "#c92f38",
    "--accent-primary": "#d44055",
    "--text-on-accent": "#ffffff",
  })
  for (const value of [
    values["--accent-primary"],
    values["--accent-hover"],
    values["--accent-pressed"],
  ]) {
    assert.ok(value)
    assert.ok(contrastAgainstWhite(value) >= 4.5)
  }
})

function contrastAgainstWhite(hex) {
  const channels = hex
    .slice(1)
    .match(/.{2}/gu)
    .map((channel) => Number.parseInt(channel, 16) / 255)
  const luminance = channels
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0)
  return 1.05 / (luminance + 0.05)
}
