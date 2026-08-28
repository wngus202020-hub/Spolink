import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { Task3EvidenceError } from "./task3-evidence-validation.mjs"

const processFailureCode = "TASK3_PUBLICATION_PROCESS_FAILED"
const cleanupFailureCode = "TASK3_PUBLICATION_CLEANUP_FAILED"
const helperSource = String.raw`
import ctypes
import errno
import json
import os
import sys

RENAME_EXCL = 4
DIRECTORY_FD = 3

def cause(error):
    return {
        "code": errno.errorcode.get(getattr(error, "errno", None), "NATIVE_ERROR"),
        "message": str(error),
    }

def emit(kind, primary, cleanup=None, recovery=None):
    sys.stderr.write(json.dumps({
        "kind": kind,
        "primary": cause(primary),
        "cleanup": cause(cleanup) if cleanup else None,
        "recovery": cause(recovery) if recovery else None,
    }, separators=(",", ":")) + "\n")

def recover_helper(script_path):
    recovery = None
    try:
        if os.path.exists(script_path):
            os.unlink(script_path)
        os.rmdir(os.path.dirname(script_path))
    except OSError as error:
        recovery = error
    return recovery

script_path = os.path.abspath(sys.argv[0])
cleanup_target, publication, output_name, temporary_name, failure_mode = sys.argv[1:]
try:
    os.unlink(cleanup_target)
    os.rmdir(os.path.dirname(script_path))
except OSError as error:
    emit("cleanup", error, recovery=recover_helper(script_path))
    sys.exit(73)

temporary_fd = None
try:
    temporary_fd = os.open(temporary_name,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=DIRECTORY_FD)
    body = sys.stdin.buffer.read()
    offset = 0
    while offset < len(body):
        offset += os.write(temporary_fd, body[offset:])
    os.fsync(temporary_fd)
    os.close(temporary_fd)
    temporary_fd = None
    if publication == "attempt":
        libc = ctypes.CDLL(None, use_errno=True)
        rename_exclusive = libc.renameatx_np
        rename_exclusive.argtypes = [ctypes.c_int, ctypes.c_char_p,
            ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        rename_exclusive.restype = ctypes.c_int
        if rename_exclusive(DIRECTORY_FD, temporary_name.encode(), DIRECTORY_FD,
                output_name.encode(), RENAME_EXCL) != 0:
            error_number = ctypes.get_errno()
            raise OSError(error_number, os.strerror(error_number))
    elif publication == "canonical":
        os.replace(temporary_name, output_name,
            src_dir_fd=DIRECTORY_FD, dst_dir_fd=DIRECTORY_FD)
    else:
        raise OSError(errno.EINVAL, "invalid publication mode")
except OSError as primary:
    if temporary_fd is not None:
        os.close(temporary_fd)
    cleanup = None
    recovery = None
    cleanup_name = temporary_name + ".missing" if failure_mode == "publication-cleanup" else temporary_name
    try:
        os.unlink(cleanup_name, dir_fd=DIRECTORY_FD)
    except OSError as error:
        cleanup = error
        if cleanup_name != temporary_name:
            try:
                os.unlink(temporary_name, dir_fd=DIRECTORY_FD)
            except OSError as recovery_error:
                recovery = recovery_error
    emit("publication", primary, cleanup=cleanup, recovery=recovery)
    sys.exit(74)
`

const productionDependencies = {
  failureMode: "none",
  makeBuildRoot: () => mkdtemp(path.join(tmpdir(), "spolink-task3-publisher-")),
  processPath: "/usr/bin/python3",
  remove: (root) => rm(root, { force: true, recursive: true }),
}

export async function publishTask3Anchored(options, overrides = {}) {
  const dependencies = { ...productionDependencies, ...overrides }
  let buildRoot
  try {
    buildRoot = await dependencies.makeBuildRoot()
    const scriptPath = path.join(buildRoot, "publish.py")
    await writeFile(scriptPath, helperSource, { mode: 0o700 })
    const cleanupTarget =
      dependencies.failureMode === "precommit-cleanup" ? `${scriptPath}.missing` : scriptPath
    await runProcess(
      dependencies.processPath,
      [
        "-I",
        scriptPath,
        cleanupTarget,
        options.publication,
        options.outputName,
        `.task3-${randomUUID()}.tmp`,
        dependencies.failureMode,
      ],
      options.body,
      [options.directoryHandle.fd],
    )
    return
  } catch (error) {
    let primary = toTask3Error(error)
    if (buildRoot) {
      try {
        await dependencies.remove(buildRoot)
      } catch (cleanup) {
        primary = attachCleanup(primary, cleanup)
      }
    }
    throw primary
  }
}

async function runProcess(command, args, input, inheritedDescriptors) {
  const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe", ...inheritedDescriptors] })
  const stderr = []
  child.stderr.on("data", (chunk) => stderr.push(chunk))
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve)
    child.once("error", reject)
  })
  child.stdin.end(input)
  return new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (exitCode, signal) => {
      if (exitCode === 0) resolve()
      else reject(nativeFailure(Buffer.concat(stderr).toString("utf8"), exitCode, signal))
    })
  })
}

function nativeFailure(stderr, exitCode, signal) {
  try {
    const payload = JSON.parse(stderr.trim())
    const error = new Error(payload.primary.message)
    error.code = payload.primary.code
    error.nativeCauses = payload
    return error
  } catch (parseError) {
    const error = new Error(stderr.trim() || `native process exited ${exitCode ?? signal}`, {
      cause: parseError,
    })
    error.code = "TASK3_NATIVE_EXIT"
    return error
  }
}

function toTask3Error(error) {
  if (error instanceof Task3EvidenceError) return error
  const native = error.nativeCauses
  const cleanup = native?.cleanup ? causeFromPayload(native.cleanup) : undefined
  const recovery = native?.recovery ? causeFromPayload(native.recovery) : undefined
  if (native?.kind === "cleanup")
    return task3Error("Anchored publication pre-commit cleanup failed", cleanupFailureCode, error, {
      cleanup: error,
      recovery,
    })
  return task3Error("Anchored publication process failed", processFailureCode, error, {
    cleanup,
    recovery,
  })
}

function attachCleanup(primary, cleanup) {
  return task3Error(primary.message, primary.code, primary.cause, { ...primary.causes, cleanup })
}

function task3Error(message, code, cause, causes) {
  return new Task3EvidenceError(message, { cause, causes, code })
}

function causeFromPayload(payload) {
  const error = new Error(payload.message)
  error.code = payload.code
  return error
}
