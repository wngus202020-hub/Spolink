import assert from "node:assert/strict"

import { requestJson, uploadSigned } from "../http-client.mjs"
import { createTinyPng } from "../image-fixtures.mjs"
import { expectStatus, hashJson, recordMutation, validSubmitIntentRace } from "./assertions.mjs"
import { deleteImage, issueIntent, registerIntent, uploadAndRegister } from "./operations.mjs"

export async function serializationMatrix(context) {
  const intentRaceLesson = await context.database.createLesson(context.provision)
  const state = await context.database.readLesson(intentRaceLesson)
  const intentRace = await runBlockedLessonRace(context, {
    first: () =>
      issueIntent(context, intentRaceLesson, "coach", "image/png", createTinyPng().length),
    firstFunction: "create_lesson_image_upload_intent",
    label: "submit_vs_intent",
    lessonId: intentRaceLesson,
    second: () =>
      requestJson(context.next.baseUrl, `/api/lessons/${intentRaceLesson}/status`, {
        body: { action: "submit", expectedUpdatedAt: state.updated_at },
        jar: context.jars.coach,
      }),
    secondFunction: "transition_lesson",
  })
  const [intentResult, submitResult] = intentRace.results
  recordMutation(context, "submit_vs_intent_submit", submitResult)
  const intentRaceStatuses = [submitResult.status, intentResult.status].sort()
  if (!validSubmitIntentRace(intentRaceStatuses)) {
    context.blockers.push({
      actual: hashJson(intentRaceStatuses),
      code: submitResult.code,
      criterion: "submit_vs_intent_serialization",
      expected: "one_success_and_one_403_or_409",
    })
  }

  const registerRaceLesson = await context.database.createLesson(context.provision)
  const intent = await issueIntent(
    context,
    registerRaceLesson,
    "coach",
    "image/png",
    createTinyPng().length,
  )
  expectStatus(context, "submit_register_intent", intent, 201)
  if (intent.status === 201) {
    context.database.trackObject(intent.body.data.objectName)
    const uploaded = await uploadSigned(
      context.clients.coach,
      intent.body.data,
      createTinyPng(),
      "image/png",
    )
    if (uploaded.error) throw new Error("Submit/register race upload failed")
    const registerState = await context.database.readLesson(registerRaceLesson)
    const registerRace = await runBlockedLessonRace(context, {
      first: () =>
        requestJson(context.next.baseUrl, `/api/lessons/${registerRaceLesson}/status`, {
          body: { action: "submit", expectedUpdatedAt: registerState.updated_at },
          jar: context.jars.coach,
        }),
      firstFunction: "transition_lesson",
      label: "submit_vs_register",
      lessonId: registerRaceLesson,
      second: () => registerIntent(context, registerRaceLesson, "coach", intent.body.data),
      secondFunction: "register_validated_lesson_image",
    })
    const [submitted, registered] = registerRace.results
    recordMutation(context, "submit_vs_register_submit", submitted)
    if (registered.status !== 201 || ![200, 409].includes(submitted.status)) {
      context.blockers.push({
        actual: hashJson([registered.status, submitted.status]),
        criterion: "submit_vs_register_serialization",
        expected: "register_201_submit_200_or_409",
      })
    }
  }

  const deleteRaceLesson = await context.database.createLesson(context.provision)
  const seeded = await uploadAndRegister(context, deleteRaceLesson, createTinyPng(), "image/png")
  expectStatus(context, "submit_delete_seed", seeded.registration, 201)
  if (seeded.registration.status === 201) {
    const images = seeded.registration.body.data.images
    const deleteState = await context.database.readLesson(deleteRaceLesson)
    const deleteRace = await runBlockedLessonRace(context, {
      first: () =>
        deleteImage(
          context,
          deleteRaceLesson,
          "coach",
          images[0].id,
          images.map((image) => image.id),
        ),
      firstFunction: "begin_delete_lesson_image",
      label: "submit_vs_delete",
      lessonId: deleteRaceLesson,
      second: () =>
        requestJson(context.next.baseUrl, `/api/lessons/${deleteRaceLesson}/status`, {
          body: { action: "submit", expectedUpdatedAt: deleteState.updated_at },
          jar: context.jars.coach,
        }),
      secondFunction: "transition_lesson",
    })
    const [deleted, submitted] = deleteRace.results
    recordMutation(context, "submit_vs_delete_submit", submitted)
    const successCount = [deleted.status === 200, submitted.status === 200].filter(Boolean).length
    if (
      successCount !== 1 ||
      ![403, 409].includes(deleted.status === 200 ? submitted.status : deleted.status)
    ) {
      context.blockers.push({
        actual: hashJson([deleted.status, submitted.status]),
        criterion: "submit_vs_delete_serialization",
        expected: "one_success_and_one_403_or_409",
      })
    }
  }
}

export async function runBlockedLessonRace(
  context,
  { first, firstFunction, label, lessonId, second, secondFunction },
) {
  const baselinePids = await context.barrier.captureBaseline()
  const holder = await context.database.holdLesson(lessonId)
  const settlementOrder = []
  let firstObserved = null
  let secondObserved = null
  try {
    const firstStartedAtWallMs = Date.now()
    const firstPromise = first()
    firstObserved = observeRaceSettlement("first", firstPromise, settlementOrder)
    const firstWait = await context.barrier.waitForBlocked({
      baselinePids,
      lockerPid: holder.lockerPid,
      workers: [raceWorker("first", firstPromise, firstFunction, firstStartedAtWallMs)],
    })

    const secondStartedAtWallMs = Date.now()
    const secondPromise = second()
    secondObserved = observeRaceSettlement("second", secondPromise, settlementOrder)
    const queuedWaits = await context.barrier.waitForBlocked({
      baselinePids,
      lockerPid: holder.lockerPid,
      workers: [
        raceWorker("first", firstPromise, firstFunction, firstStartedAtWallMs, firstWait[0].pid),
        raceWorker("second", secondPromise, secondFunction, secondStartedAtWallMs, undefined, [
          firstWait[0].pid,
        ]),
      ],
    })
    const firstQueued = queuedWaits.find((wait) => wait.workerLabel === "first")
    const secondQueued = queuedWaits.find((wait) => wait.workerLabel === "second")
    assert.ok(firstQueued && secondQueued)
    context.observations.push({
      barrierChainLengths: {
        first: firstQueued.blockerChain.length,
        firstInitial: firstWait[0].blockerChain.length,
        second: secondQueued.blockerChain.length,
      },
      bodySha256: hashJson({
        first: firstQueued.querySha256,
        second: secondQueued.querySha256,
      }),
      functions: [firstQueued.matchedFunction, secondQueued.matchedFunction],
      label: `${label}_db_barrier_observed`,
      status: 200,
      waitEventTypes: [firstQueued.waitEventType, secondQueued.waitEventType],
    })
    assert.equal(firstWait[0].blockerChain.length, 2)
    assert.equal(firstQueued.blockerChain.length, 2)
    assert.equal(secondQueued.blockerChain.length, 3)
    assert.equal(firstWait[0].matchedFunction, firstFunction)
    assert.equal(firstQueued.matchedFunction, firstFunction)
    assert.equal(secondQueued.matchedFunction, secondFunction)

    holder.release()
    await holder.done
    const results = await Promise.all([firstObserved, secondObserved])
    context.observations.push({
      bodySha256: hashJson(settlementOrder),
      label: `${label}_db_barrier_released`,
      settlementOrder,
      status: 200,
    })
    return { results }
  } catch (error) {
    holder.abort()
    await holder.done
    await Promise.allSettled([firstObserved, secondObserved].filter(Boolean))
    throw error
  }
}

export function observeRaceSettlement(label, promise, settlementOrder) {
  return promise.then(
    (value) => {
      settlementOrder.push(label)
      return value
    },
    (error) => {
      settlementOrder.push(label)
      throw error
    },
  )
}

export function raceWorker(label, promise, functionName, startedAtWallMs, pid, excludePids = []) {
  return {
    excludePids,
    functionNames: [functionName],
    label,
    pid,
    promise,
    startedAtHrtimeNs: process.hrtime.bigint().toString(),
    startedAtWallMs,
  }
}
