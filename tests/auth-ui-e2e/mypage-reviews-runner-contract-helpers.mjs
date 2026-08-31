import { spawn } from "node:child_process"
import { access, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import typescript from "typescript"

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)))
const specPath = path.join(repoRoot, "tests/auth-ui-e2e/mypage-reviews.spec.ts")
const scenarioPath = path.join(repoRoot, "tests/auth-ui-e2e/mypage-reviews-scenario.ts")
const assertionsPath = path.join(repoRoot, "tests/auth-ui-e2e/mypage-reviews-assertions.ts")
const runnerPath = path.join(repoRoot, "tests/auth-ui-e2e/run-mypage-reviews.mjs")
const runnerFinalizePath = path.join(
  repoRoot,
  "tests/auth-ui-e2e/mypage-reviews-runner-finalize.mjs",
)

export function semanticObligationDiagnostics(mutationTarget = null) {
  const configPath = path.join(repoRoot, "tsconfig.json")
  const config = typescript.readConfigFile(configPath, typescript.sys.readFile)
  if (config.error) throw new Error(formatDiagnostics([config.error]))
  const parsed = typescript.parseJsonConfigFileContent(config.config, typescript.sys, repoRoot)
  if (parsed.errors.length > 0) throw new Error(formatDiagnostics(parsed.errors))
  const options = { ...parsed.options, incremental: false, noEmit: true }
  const host = typescript.createCompilerHost(options)
  const originalGetSourceFile = host.getSourceFile.bind(host)
  const mutationPath = mutationTarget === "scenario" ? scenarioPath : assertionsPath
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (mutationTarget && path.resolve(fileName) === mutationPath) {
      return typescript.createSourceFile(
        fileName,
        "export {}\n",
        languageVersion,
        true,
        typescript.ScriptKind.TS,
      )
    }
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
  }
  const program = typescript.createProgram({ host, options, rootNames: [specPath] })
  return typescript.getPreEmitDiagnostics(program).map((diagnostic) => ({
    code: diagnostic.code,
    message: typescript.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  }))
}

export async function inspectOutOfRangeRecovery() {
  const source = await readFile(assertionsPath, "utf8")
  const file = typescript.createSourceFile(
    assertionsPath,
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  )
  const target = file.statements.find(
    (statement) =>
      typescript.isFunctionDeclaration(statement) &&
      statement.name?.text === "assertOutOfRangeRecovery",
  )
  if (!target || !typescript.isFunctionDeclaration(target)) {
    throw new Error("assertOutOfRangeRecovery is missing.")
  }
  const observation = { firstPageLinkClick: false, pageOneUrlAssertion: false, requestedUrl: null }
  visit(target, (node) => {
    if (!typescript.isCallExpression(node)) return
    if (propertyName(node.expression) === "goto" && typescript.isStringLiteral(node.arguments[0])) {
      observation.requestedUrl = node.arguments[0].text
    }
    if (propertyName(node.expression) === "click") {
      const receiver = receiverCall(node.expression)
      if (
        receiver &&
        propertyName(receiver.expression) === "getByRole" &&
        receiver.arguments.some(
          (argument) =>
            typescript.isObjectLiteralExpression(argument) &&
            argument.properties.some(
              (property) =>
                typescript.isPropertyAssignment(property) &&
                property.name.getText(file) === "name" &&
                typescript.isStringLiteral(property.initializer) &&
                property.initializer.text === "첫 페이지 보기",
            ),
        )
      ) {
        observation.firstPageLinkClick = true
      }
    }
    if (
      propertyName(node.expression) === "toHaveURL" &&
      node.arguments.some(
        (argument) =>
          typescript.isRegularExpressionLiteral(argument) &&
          argument.text === "/\\/mypage\\/reviews$/u",
      )
    ) {
      observation.pageOneUrlAssertion = true
    }
  })
  return observation
}

export async function inspectRunnerVisualObligations() {
  const source = `${await readFile(runnerPath, "utf8")}\n${await readFile(runnerFinalizePath, "utf8")}`
  const file = typescript.createSourceFile(
    runnerPath,
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.JS,
  )
  const calls = new Set()
  const stringValues = []
  let exactImageCount = null
  visit(file, (node) => {
    if (typescript.isCallExpression(node)) {
      const name =
        propertyName(node.expression) ??
        (typescript.isIdentifier(node.expression) ? node.expression.text : null)
      if (name) calls.add(name)
    }
    if (typescript.isStringLiteral(node)) stringValues.push(node.text)
    if (
      typescript.isVariableDeclaration(node) &&
      typescript.isIdentifier(node.name) &&
      node.name.text === "exactVisualImageCount" &&
      node.initializer &&
      typescript.isNumericLiteral(node.initializer)
    ) {
      exactImageCount = Number(node.initializer.text)
    }
  })
  return {
    exactImageCount,
    publishesVisualBundle: calls.has("validateAndPublishVisualBundle"),
    removesFailedPublication: calls.has("removePublishedVisuals"),
    writesCanonicalManifest: stringValues.includes("source-manifest.json"),
    writesVisualSummary: stringValues.includes("visual-summary.json"),
  }
}

export async function runMalformedRunner(runnerPath, timeoutMs = 4_000) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "spolink-mypage-reviews-malformed-"))
  const outputPath = path.join(directory, "failure.json")
  const startedAt = Date.now()
  const child = spawn(process.execPath, [runnerPath, outputPath], {
    cwd: repoRoot,
    env: { ...process.env },
    stdio: ["ignore", "ignore", "pipe"],
  })
  let stderr = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill("SIGKILL")
  }, timeoutMs)
  const result = await new Promise((resolve) => {
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }))
  })
  clearTimeout(timer)
  let summary = null
  try {
    await access(outputPath)
    summary = JSON.parse(await readFile(outputPath, "utf8"))
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("ENOENT")) throw error
  }
  return {
    ...result,
    cleanup: () => rm(directory, { force: true, recursive: true }),
    durationMs: Date.now() - startedAt,
    stderr,
    summary,
    timedOut,
  }
}

function formatDiagnostics(diagnostics) {
  return typescript.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => repoRoot,
    getNewLine: () => "\n",
  })
}

function visit(node, inspect) {
  inspect(node)
  node.forEachChild((child) => visit(child, inspect))
}

function propertyName(expression) {
  return typescript.isPropertyAccessExpression(expression) ? expression.name.text : null
}

function receiverCall(expression) {
  return typescript.isPropertyAccessExpression(expression) &&
    typescript.isCallExpression(expression.expression)
    ? expression.expression
    : null
}
