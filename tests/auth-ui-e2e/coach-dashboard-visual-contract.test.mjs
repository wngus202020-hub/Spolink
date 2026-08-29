import assert from "node:assert/strict"
import test from "node:test"

import {
  analyzePixelBuffer,
  contrastRatio,
  detectGeometryIssues,
} from "./coach-dashboard-visual-contract.mjs"

const validGeometry = {
  boxes: [
    {
      clientHeight: 40,
      clientWidth: 180,
      height: 40,
      name: "first",
      parent: "main",
      scrollHeight: 40,
      scrollWidth: 180,
      width: 180,
      x: 0,
      y: 0,
    },
    {
      clientHeight: 40,
      clientWidth: 180,
      height: 40,
      name: "second",
      parent: "main",
      scrollHeight: 40,
      scrollWidth: 180,
      width: 180,
      x: 200,
      y: 0,
    },
  ],
  cjkOrphans: 0,
  documentWidth: 390,
  focusRequired: false,
  focused: true,
  issueIndicators: 0,
  replacementGlyphs: 0,
  stableGroups: [{ heights: [40, 40], name: "actions", widths: [180, 180] }],
  viewportWidth: 390,
}

test("visual geometry detector accepts a coherent snapshot", () => {
  assert.deepEqual(detectGeometryIssues(validGeometry), [])
})

test("visual geometry detector rejects deliberate layout focus and issue-indicator defects", () => {
  assert.deepEqual(
    new Set(
      detectGeometryIssues({
        ...validGeometry,
        boxes: [
          validGeometry.boxes[0],
          {
            ...validGeometry.boxes[1],
            clientWidth: 100,
            scrollWidth: 140,
            x: 100,
          },
        ],
        documentWidth: 430,
        focusRequired: true,
        focused: false,
        issueIndicators: 1,
      }),
    ),
    new Set([
      "document-overflow",
      "element-clipping",
      "focus-missing",
      "issue-indicator",
      "sibling-overlap",
    ]),
  )
})

test("visual pixel detector rejects a deliberately blank image", () => {
  const blank = Buffer.alloc(4 * 16 * 16, 255)
  const analysis = analyzePixelBuffer({ data: blank, height: 16, width: 16 })

  assert.equal(analysis.blank, true)
  assert.ok(analysis.uniqueColors < 8)
})

test("visual contrast detector rejects unreadable rendered colors", () => {
  assert.ok(contrastRatio([120, 120, 120], [130, 130, 130]) < 4.5)
  assert.ok(contrastRatio([24, 24, 24], [245, 245, 245]) >= 4.5)
})
