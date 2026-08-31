import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"

export const workspaceRoot = path.resolve(
  process.env["SPOLINK_DOCUMENTATION_ROOT"] ?? process.cwd(),
)

export function readDocument(relativePath) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8")
}

export function section(markdown, heading) {
  const lines = markdown.split("\n")
  const start = lines.indexOf(heading)
  assert.notEqual(start, -1, `missing heading: ${heading}`)
  const level = heading.match(/^#+/u)?.[0].length ?? 0
  const end = lines.findIndex(
    (line, index) => index > start && new RegExp(`^#{1,${level}}\\s`, "u").test(line),
  )
  return lines.slice(start, end === -1 ? lines.length : end).join("\n")
}

export function tableRows(markdown) {
  const rows = markdown
    .split("\n")
    .filter((line) => /^\|.*\|$/u.test(line.trim()))
    .map((line) =>
      line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    )
  return rows.filter((row, index) => index !== 1 && !row.every((cell) => /^-+$/u.test(cell)))
}

export function labeledBlock(markdown, label) {
  const lines = markdown.split("\n")
  const start = lines.indexOf(label)
  assert.notEqual(start, -1, `missing label: ${label}`)
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line && (/^#{1,6}\s/u.test(line) || (/^[^|`-].*:\s*$/u.test(line) && index > start + 1))) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join("\n")
}

export function tableRecords(markdown) {
  const [headers, ...rows] = tableRows(markdown)
  assert.ok(headers)
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])))
}

export function inlineCode(markdown) {
  return [...markdown.matchAll(/`([^`\n]+)`/gu)].map((match) => match[1])
}

export function fencedBlocks(markdown, language) {
  const fence = "```"
  const pattern = new RegExp(`${fence}${language}\\s*([\\s\\S]*?)${fence}`, "gu")
  return [...markdown.matchAll(pattern)].map((match) => match[1].trim())
}

export function bullets(markdown) {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => ({ code: inlineCode(line), text: line.slice(2) }))
}

export function normalizeCondition(value) {
  return value.replaceAll("`", "").replace(/\s+/gu, " ").trim()
}
