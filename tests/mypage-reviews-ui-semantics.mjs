import assert from "node:assert/strict"
import typescript from "typescript"

const requiredStates = new Set(["empty", "out_of_range", "read_failure", "ready"])

export function assertReviewPageSemanticContract(source) {
  const file = typescript.createSourceFile(
    "page.tsx",
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TSX,
  )
  let ownerArgument = null
  const states = new Set()
  visit(file)
  assert.equal(ownerArgument, "auth.profile.id")
  assert.deepEqual(states, requiredStates)

  function visit(node) {
    if (
      typescript.isCallExpression(node) &&
      node.expression.getText(file) === "readReviewHistoryData"
    ) {
      ownerArgument = node.arguments[0]?.getText(file) ?? null
    }
    if (
      typescript.isBinaryExpression(node) &&
      node.left.getText(file) === "reviewData.state" &&
      typescript.isStringLiteral(node.right)
    ) {
      states.add(node.right.text)
    }
    typescript.forEachChild(node, visit)
  }
}
