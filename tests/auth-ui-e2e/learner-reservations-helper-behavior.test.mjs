import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import test from "node:test"
import { downloadCalendar } from "./learner-reservations-calendar-assertions.ts"
import { isForbiddenReadOnlyRequest } from "./learner-reservations-request-guards.ts"
import {
  reservationPhaseNames,
  runLearnerReservationPhases,
} from "./learner-reservations-scenario-contract.ts"
import { captureReservationScreenshot } from "./learner-reservations-visual-assertions.ts"
import { collectScreenshotReceipts } from "./run-learner-reservations.mjs"

test("learner reservation phase runner executes nine ordered phases and cleanup", async () => {
  const calls = []
  const actions = phaseActions(calls)

  await runLearnerReservationPhases({
    actions,
    runPhase: async (name, action) => {
      calls.push(`phase:${name}`)
      return action()
    },
  })

  assert.deepEqual(
    calls.filter((call) => call.startsWith("phase:")),
    Object.values(reservationPhaseNames).map((name) => `phase:${name}`),
  )
  assert.equal(calls.at(-1), "action:cleanup")
})

test("learner reservation phase runner cleans up and propagates the original error", async () => {
  const calls = []
  const failure = new Error("navigation failed")
  const actions = phaseActions(calls, { reservationNavigation: failure })

  await assert.rejects(
    () =>
      runLearnerReservationPhases({
        actions,
        runPhase: async (name, action) => {
          calls.push(`phase:${name}`)
          return action()
        },
      }),
    (error) => error === failure,
  )
  assert.equal(calls.includes("phase:completion success/read-only routes"), false)
  assert.deepEqual(calls.slice(-2), ["phase:cleanup", "action:cleanup"])
})

test("calendar helper consumes a realistic download stream and returns a 441-byte receipt", async () => {
  const bytes = calendarBytes(441)
  const calls = []
  const page = {
    getByRole(role, options) {
      calls.push(["locator", role, options.name])
      return { click: async () => calls.push(["click", options.name]) }
    },
    waitForEvent: async (event) => {
      calls.push(["event", event])
      return {
        createReadStream: async () => Readable.from([bytes.subarray(0, 211), bytes.subarray(211)]),
        suggestedFilename: () => "spolink-reservation.ics",
      }
    },
  }

  const receipt = await downloadCalendar(page, {
    endsAt: "2026-08-20T02:00:00.000Z",
    lessonTitle: "러닝 기초",
    startsAt: "2026-08-20T01:00:00.000Z",
  })

  assert.equal(receipt.bytes, 441)
  assert.match(receipt.sha256, /^[0-9a-f]{64}$/u)
  assert.deepEqual(calls, [
    ["event", "download"],
    ["locator", "link", "캘린더 등록"],
    ["click", "캘린더 등록"],
  ])
})

test("request guard rejects every read-only mutation and Toss request", () => {
  const request = (method, url) => ({ method: () => method, url: () => url })
  assert.equal(isForbiddenReadOnlyRequest(request("GET", "https://spolink.test/read")), false)
  for (const pathname of [
    "/api/reservations/id/cancel",
    "/api/reservations/id/complete",
    "/api/reservations/id/no-show",
    "/api/payments/confirm",
    "/api/payments/prepare",
  ]) {
    assert.equal(
      isForbiddenReadOnlyRequest(request("POST", `https://spolink.test${pathname}`)),
      true,
    )
  }
  assert.equal(
    isForbiddenReadOnlyRequest(request("GET", "https://api.tosspayments.com/v1/payments")),
    true,
  )
})

test("reservation screenshot helper sends the settled evidence path to a page fake", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "spolink-reservation-shot-"))
  const previous = process.env["SPOLINK_VISUAL_QA_DIR"]
  const calls = []
  process.env["SPOLINK_VISUAL_QA_DIR"] = root
  try {
    const page = {
      addStyleTag: async ({ content }) => calls.push(["style", content]),
      screenshot: async (options) => {
        calls.push(["screenshot", options])
        await writeFile(options.path, "fake-png")
      },
    }
    await captureReservationScreenshot(page, "mobile-chromium", "hub")
    const screenshotPath = path.join(root, "learner-reservations-hub-mobile-chromium.png")
    assert.equal(await readFile(screenshotPath, "utf8"), "fake-png")
    assert.equal(calls[0][0], "style")
    assert.deepEqual(calls[1][1], { fullPage: true, path: screenshotPath })
  } finally {
    if (previous === undefined) delete process.env["SPOLINK_VISUAL_QA_DIR"]
    else process.env["SPOLINK_VISUAL_QA_DIR"] = previous
    await rm(root, { force: true, recursive: true })
  }
})

test("runner hashes six realistic completion PNG receipts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "spolink-completion-receipts-"))
  try {
    for (const width of [390, 768, 1280]) {
      for (const state of ["success", "recovery"]) {
        const bytes = Buffer.alloc(32, width % 251)
        Buffer.from("89504e470d0a1a0a", "hex").copy(bytes)
        bytes.writeUInt32BE(width, 16)
        bytes.writeUInt32BE(width === 390 ? 844 : 900, 20)
        await writeFile(path.join(root, `completion-${state}-${width}.png`), bytes)
      }
    }

    const receipts = await collectScreenshotReceipts(root)

    assert.equal(receipts.length, 6)
    assert.deepEqual(
      receipts.map(({ name }) => name),
      [
        "completion-success-390.png",
        "completion-recovery-390.png",
        "completion-success-768.png",
        "completion-recovery-768.png",
        "completion-success-1280.png",
        "completion-recovery-1280.png",
      ],
    )
    assert.equal(
      receipts.every(({ sha256 }) => /^[0-9a-f]{64}$/u.test(sha256)),
      true,
    )
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

function phaseActions(calls, failures = {}) {
  const action = (name, result) => async () => {
    calls.push(`action:${name}`)
    if (failures[name]) throw failures[name]
    return result
  }
  return {
    authSessions: action("authSessions", { learner: "session" }),
    fixtureSeed: async (sessions) => {
      assert.equal(sessions.learner, "session")
      return action("fixtureSeed", { startsAt: "start" })()
    },
    learnerActivation: action("learnerActivation"),
    myPageDocument: action("myPageDocument"),
    myPageReadModel: action("myPageReadModel"),
    reservationNavigation: action("reservationNavigation"),
    completionSuccess: async (fixture) => {
      assert.equal(fixture.startsAt, "start")
      return action("completionSuccess")()
    },
    completionRecovery: action("completionRecovery"),
    cleanup: action("cleanup"),
  }
}

function calendarBytes(expectedLength) {
  const head = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "DTSTART:20260820T010000Z",
    "DTEND:20260820T020000Z",
    "SUMMARY:러닝 기초",
  ].join("\r\n")
  const tail = "\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
  const prefix = `${head}\r\nDESCRIPTION:`
  const filler = "x".repeat(expectedLength - Buffer.byteLength(prefix) - Buffer.byteLength(tail))
  const bytes = Buffer.from(`${prefix}${filler}${tail}`)
  assert.equal(bytes.byteLength, expectedLength)
  return bytes
}
