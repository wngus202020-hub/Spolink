import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import test from "node:test"

import {
  cleanupExpiredLessonImageUploads,
  deleteLessonImage,
  flushMicrotasks,
  imageId,
  intent,
  intentId,
  issueLessonImageUploadIntent,
  LESSON_IMAGE_OPPORTUNISTIC_CLEANUP_LIMIT,
  LESSON_IMAGE_OPPORTUNISTIC_CLEANUP_TIMEOUT_MS,
  LessonImageStorageError,
  lessonId,
  objectName,
  registerLessonImage,
  webpBytes,
} from "./fixtures.mjs"

test("Given package scripts, when cleanup command is resolved, then it points to the guarded CLI", () => {
  const command = JSON.parse(
    execFileSync("corepack", ["pnpm", "pkg", "get", "scripts.lesson-images:cleanup"], {
      cwd: new URL("../../..", import.meta.url),
      encoding: "utf8",
    }),
  )

  assert.equal(command, "node scripts/lesson-images-cleanup.mjs")
  assert.equal(
    existsSync(new URL("../../../scripts/lesson-images-cleanup.mjs", import.meta.url)),
    true,
  )
})

test("Given cleanup failure, when each owner mutation runs, then one bounded redacted failure is reported without blocking", async () => {
  const cleanupLimits = []
  const cleanupErrors = []
  const mutationEvents = []
  const cleanupDependencies = {
    reportOpportunisticCleanupError: (error) => cleanupErrors.push(error),
    runOpportunisticCleanup: async (limit) => {
      mutationEvents.push("cleanup")
      cleanupLimits.push(limit)
      throw new Error("service_role=must-not-leak")
    },
  }

  const signed = await issueLessonImageUploadIntent(
    { lessonId, mimeType: "image/webp", sizeBytes: 12 },
    {
      ...cleanupDependencies,
      cancelUploadIntent: async () => {},
      createSignedUploadUrl: async () => ({ signedUrl: "/signed", token: "upload-token" }),
      createUploadIntent: async () => {
        mutationEvents.push("issue")
        return intent()
      },
    },
  )
  const registered = await registerLessonImage(
    { intentId, objectName },
    {
      ...cleanupDependencies,
      downloadObject: async () => new Blob([Uint8Array.from(webpBytes)], { type: "image/webp" }),
      finalizeUploadIntent: async () => {},
      registerImage: async () => ({ id: imageId }),
      removeObject: async () => "removed",
      resolveCurrentUserIntent: async () => {
        mutationEvents.push("register")
        return intent()
      },
    },
  )
  const deleted = await deleteLessonImage(
    { expectedImageIds: [], imageId, lessonId },
    {
      ...cleanupDependencies,
      beginDelete: async () => {
        mutationEvents.push("delete")
        return { images: [], kind: "already_deleted" }
      },
      finalizeDelete: async () => [],
      removeObject: async () => "removed",
    },
  )

  assert.equal(signed.intentId, intentId)
  assert.deepEqual(registered, { id: imageId })
  assert.deepEqual(deleted, [])
  assert.deepEqual(cleanupLimits, [5, 5, 5])
  assert.deepEqual(mutationEvents, ["cleanup", "issue", "cleanup", "register", "cleanup", "delete"])
  assert.equal(LESSON_IMAGE_OPPORTUNISTIC_CLEANUP_LIMIT, 5)
  assert.equal(cleanupErrors.length, 3)
  for (const error of cleanupErrors) {
    assert.ok(error instanceof LessonImageStorageError)
    assert.equal(error.code, "cleanup_failed")
    assert.equal(error.retryable, true)
    assert.doesNotMatch(JSON.stringify(error), /service_role|must-not-leak/u)
  }
})

test("Given direct cleanup dependencies, when cleanup CLI domain work runs, then mutation cleanup does not recurse", async () => {
  let opportunisticCalls = 0

  const result = await cleanupExpiredLessonImageUploads(1, {
    claimExpiredUploadIntents: async () => [],
    finalizeCleanup: async () => {},
    removeObject: async () => "removed",
    reportOpportunisticCleanupError: () => {},
    runOpportunisticCleanup: async () => {
      opportunisticCalls += 1
    },
  })

  assert.deepEqual(result, { claimed: 0, cleaned: 0, failed: 0 })
  assert.equal(opportunisticCalls, 0)
})

for (const fixture of [
  {
    label: "issue",
    run: (cleanup, markMutationStarted) =>
      issueLessonImageUploadIntent(
        { lessonId, mimeType: "image/webp", sizeBytes: 12 },
        {
          ...cleanup,
          cancelUploadIntent: async () => {},
          createSignedUploadUrl: async () => ({ signedUrl: "/signed", token: "upload-token" }),
          createUploadIntent: async () => {
            markMutationStarted()
            return intent()
          },
        },
      ),
  },
  {
    label: "register",
    run: (cleanup, markMutationStarted) =>
      registerLessonImage(
        { intentId, objectName },
        {
          ...cleanup,
          downloadObject: async () =>
            new Blob([Uint8Array.from(webpBytes)], { type: "image/webp" }),
          finalizeUploadIntent: async () => {},
          registerImage: async () => ({ id: imageId }),
          removeObject: async () => "removed",
          resolveCurrentUserIntent: async () => {
            markMutationStarted()
            return intent()
          },
        },
      ),
  },
  {
    label: "delete",
    run: (cleanup, markMutationStarted) =>
      deleteLessonImage(
        { expectedImageIds: [], imageId, lessonId },
        {
          ...cleanup,
          beginDelete: async () => {
            markMutationStarted()
            return { images: [], kind: "already_deleted" }
          },
          finalizeDelete: async () => [],
          removeObject: async () => "removed",
        },
      ),
  },
]) {
  test(`Given never-settling cleanup, when ${fixture.label} waits for its budget, then owner mutation completes once`, async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] })
    let cleanupCalls = 0
    let mutationCalls = 0
    const reported = []
    let resolveCleanup
    const action = fixture.run(
      {
        reportOpportunisticCleanupError: (error) => reported.push(error),
        runOpportunisticCleanup: async () => {
          cleanupCalls += 1
          return new Promise((resolve) => {
            resolveCleanup = resolve
          })
        },
      },
      () => {
        mutationCalls += 1
      },
    )
    await Promise.resolve()

    context.mock.timers.tick(24)
    await Promise.resolve()
    assert.equal(mutationCalls, 0)
    context.mock.timers.tick(1)
    await flushMicrotasks()

    assert.equal(mutationCalls, 1)
    assert.equal(LESSON_IMAGE_OPPORTUNISTIC_CLEANUP_TIMEOUT_MS, 25)
    await action
    assert.equal(cleanupCalls, 1)
    assert.equal(reported.length, 1)
    assert.equal(reported[0].code, "cleanup_failed")
    assert.equal(reported[0].retryable, true)
    resolveCleanup()
    await flushMicrotasks()
  })
}

test("Given cleanup rejects after timeout, when issue completes, then no unhandled rejection or duplicate mutation occurs", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const unhandled = []
  const listener = (reason) => unhandled.push(reason)
  process.on("unhandledRejection", listener)
  let rejectCleanup
  let mutationCalls = 0

  try {
    const action = issueLessonImageUploadIntent(
      { lessonId, mimeType: "image/webp", sizeBytes: 12 },
      {
        cancelUploadIntent: async () => {},
        createSignedUploadUrl: async () => ({ signedUrl: "/signed", token: "upload-token" }),
        createUploadIntent: async () => {
          mutationCalls += 1
          return intent()
        },
        reportOpportunisticCleanupError: () => {},
        runOpportunisticCleanup: () =>
          new Promise((_resolve, reject) => {
            rejectCleanup = reject
          }),
      },
    )
    await Promise.resolve()
    context.mock.timers.tick(25)
    await flushMicrotasks()
    assert.equal(mutationCalls, 1)
    await action

    rejectCleanup(new Error("late service_role=must-not-leak"))
    await flushMicrotasks()

    assert.equal(unhandled.length, 0)
    assert.equal(mutationCalls, 1)
  } finally {
    process.off("unhandledRejection", listener)
    context.mock.timers.reset()
  }
})
