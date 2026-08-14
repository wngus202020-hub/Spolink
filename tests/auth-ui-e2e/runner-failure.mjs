import { redactForEvidence } from "../staging-contract/contract.mjs"

export function safeRunnerFailure(error) {
  return redactForEvidence({
    category: "auth-runner-failure",
    errorClass: classifyFailure(error),
    exitCode: 1,
    phase: "execution",
    title: "local-auth-runtime-e2e",
  })
}

function classifyFailure(error) {
  if (error instanceof TypeError) return "TypeError"
  if (error instanceof RangeError) return "RangeError"
  if (error instanceof SyntaxError) return "SyntaxError"
  if (error instanceof ReferenceError) return "ReferenceError"
  if (error instanceof URIError) return "URIError"
  if (error instanceof EvalError) return "EvalError"
  if (error instanceof AggregateError) return "AggregateError"
  return error instanceof Error ? "Error" : "NonError"
}
