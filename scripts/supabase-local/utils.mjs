import { constants, open, readFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

export function absoluteEvidencePath(relativePath) {
  return path.join(process.cwd(), relativePath)
}

export function siblingEvidencePath(receiptPath, evidencePath) {
  return path.join(path.dirname(receiptPath), path.basename(evidencePath))
}

export async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"))
}

export async function readMode0600JsonFile(filePath, modeError) {
  let fileHandle
  let primaryError
  let closeError
  let parsedValue
  try {
    try {
      fileHandle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch (error) {
      if (error?.code === "ELOOP") {
        throw new Error(modeError)
      }
      throw error
    }
    const fileStat = await fileHandle.stat()
    if (!fileStat.isFile() || (fileStat.mode & 0o777) !== 0o600) {
      throw new Error(modeError)
    }
    parsedValue = JSON.parse(await fileHandle.readFile("utf8"))
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (fileHandle) {
      try {
        await fileHandle.close()
      } catch (error) {
        if (!primaryError) {
          closeError = error
        }
      }
    }
  }
  if (closeError) {
    throw closeError
  }
  return parsedValue
}

export function assertExactKeys(value, expectedKeys, label) {
  if (!isPlainObject(value)) {
    throw new Error(`Invalid ${label}`)
  }
  const actualKeys = Object.keys(value).sort()
  const sortedExpected = [...expectedKeys].sort()
  if (
    actualKeys.length !== sortedExpected.length ||
    actualKeys.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(`Expected exact ${label} schema`)
  }
}

export function uniqueNumbers(values) {
  return [...new Set(values)].sort((left, right) => left - right)
}

export function uniqueStrings(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

export function sameNumberArray(left, right) {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

export function isPlainObject(value) {
  return (
    value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
  )
}

export function signalProcessGroup(child, signal) {
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error?.code !== "ESRCH") {
      child.kill(signal)
    }
  }
}

export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
