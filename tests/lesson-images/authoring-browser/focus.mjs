import assert from "node:assert/strict"

export async function readFocusState(locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      activeElement: document.activeElement === element,
      focusVisible: element.matches(":focus-visible"),
      outlineColor: style.outlineColor,
      outlineOffset: style.outlineOffset,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      role: element.getAttribute("role"),
      text: element.textContent?.trim() ?? "",
    }
  })
}

export function assertFocusVisible(state, label) {
  assert.equal(state.activeElement, true, `${label}: active element`)
  assert.equal(state.focusVisible, true, `${label}: :focus-visible`)
  assert.equal(state.outlineStyle, "solid", `${label}: solid outline`)
  assert.equal(state.outlineWidth, "2px", `${label}: outline width`)
  assert.equal(state.outlineOffset, "3px", `${label}: outline offset`)
}

export function assertFocusedAlert(state, label) {
  assert.equal(state.activeElement, true, `${label}: active element`)
  assert.equal(state.role, "alert", `${label}: alert role`)
  assert.equal(state.outlineStyle, "solid", `${label}: solid outline`)
  assert.equal(state.outlineWidth, "2px", `${label}: outline width`)
  assert.equal(state.outlineOffset, "2px", `${label}: outline offset`)
}
