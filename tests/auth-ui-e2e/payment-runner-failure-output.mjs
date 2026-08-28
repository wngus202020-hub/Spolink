import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { sha256 } from "./process.mjs"

const paymentObservablePrefix = "PAYMENT_E2E_OBSERVABLE_REDACTED "
const emailPattern =
  /(^|[^\p{L}\p{N}_%+-])[\p{L}\p{N}][\p{L}\p{N}._%+-]*@(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+[\p{L}]{2,}(?=$|[^\p{L}\p{N}_%+-])/giu

export function readPaymentObservables(stdout) {
  return stdout
    .split(/\r?\n/u)
    .filter((line) => line.includes(paymentObservablePrefix))
    .map((line) => parsePaymentObservable(line.slice(line.indexOf(paymentObservablePrefix))))
    .filter((observable) => observable !== null)
}

export async function writeRedactedFailureOutput(outputPath, result) {
  const basePath = outputPath.replace(/\.json$/u, "")
  const stdoutPath = `${basePath}.stdout.redacted.log`
  const stderrPath = `${basePath}.stderr.redacted.log`
  const stdout = redactOutput(result.stdout)
  const stderr = redactOutput(result.stderr)
  await Promise.all([writeMode600(stdoutPath, stdout), writeMode600(stderrPath, stderr)])
  return {
    stderrPath,
    stderrSha256: sha256(stderr),
    stdoutPath,
    stdoutSha256: sha256(stdout),
  }
}

async function writeMode600(filePath, content) {
  await mkdir(path.dirname(filePath), { mode: 0o700, recursive: true })
  await writeFile(filePath, content, { mode: 0o600 })
  await chmod(filePath, 0o600)
}

function redactOutput(value) {
  return value
    .replace(emailPattern, "$1<redacted-email>")
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "<redacted-jwt>")
    .replace(/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+\b/gu, "<redacted-supabase-key>")
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/giu, "<redacted-postgres-url>")
    .replace(/(^|[^\w-])((?:set-)?cookie)\s*:\s*[^\r\n]*/giu, "$1$2: <redacted>")
    .replace(/(^|[^\w-])(authorization)\s*:\s*[^\r\n]*/giu, "$1$2: <redacted>")
}

function parsePaymentObservable(line) {
  try {
    const value = JSON.parse(line.slice(paymentObservablePrefix.length))
    if (
      value !== null &&
      typeof value === "object" &&
      ["desktop-chromium", "mobile-chromium"].includes(value.project) &&
      [
        value.browserConsoleErrorCount,
        value.forbiddenRequestCount,
        value.pageErrorCount,
        value.prepareRequestCount,
        value.readyPaymentRowCount,
        value.requestFailureCount,
      ].every(Number.isInteger)
    ) {
      return value
    }
  } catch {
    return null
  }
  return null
}
