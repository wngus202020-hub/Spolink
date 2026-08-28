import { uploadSigned } from "../http-client.mjs"
import { createTinyJpeg, createTinyPng, createTinyWebp } from "../image-fixtures.mjs"
import { expectStatus, hashJson } from "./assertions.mjs"
import { MIME_FIXTURES } from "./image-cases.mjs"
import { issueIntent, registerIntent, uploadAndRegister } from "./operations.mjs"
import { runBlockedLessonRace } from "./serialization-races.mjs"

export async function capacityAndConcurrency(context) {
  const sequentialLesson = await context.database.createLesson(context.provision)
  for (let index = 0; index < 5; index += 1) {
    const [mimeType, createBytes] = MIME_FIXTURES[index % MIME_FIXTURES.length]
    const result = await uploadAndRegister(context, sequentialLesson, createBytes(), mimeType)
    expectStatus(context, `ordered_register_${index + 1}`, result.registration, 201)
    if (result.registration.status === 201) {
      const orders = result.registration.body.data.images.map((image) => image.sortOrder)
      if (orders.join(",") !== Array.from({ length: index + 1 }, (_, item) => item).join(",")) {
        context.blockers.push({
          actual: hashJson(orders),
          criterion: `dense_order_${index + 1}`,
          expected: hashJson(Array.from({ length: index + 1 }, (_, item) => item)),
        })
      }
    }
  }
  const sixth = await issueIntent(
    context,
    sequentialLesson,
    "coach",
    "image/png",
    createTinyPng().length,
  )
  expectStatus(context, "sixth_image", sixth, 409)

  const raceLesson = await context.database.createLesson(context.provision)
  for (let index = 0; index < 4; index += 1) {
    const result = await uploadAndRegister(context, raceLesson, createTinyPng(), "image/png")
    expectStatus(context, `race_seed_${index + 1}`, result.registration, 201)
  }
  const capacityRace = await runBlockedLessonRace(context, {
    first: () => issueIntent(context, raceLesson, "coach", "image/jpeg", createTinyJpeg().length),
    firstFunction: "create_lesson_image_upload_intent",
    label: "parallel_4_to_5",
    lessonId: raceLesson,
    second: () => issueIntent(context, raceLesson, "coach", "image/webp", createTinyWebp().length),
    secondFunction: "create_lesson_image_upload_intent",
  })
  const attempts = capacityRace.results
  const successes = attempts.filter((result) => result.status === 201)
  const conflicts = attempts.filter((result) => result.status === 409)
  if (successes.length !== 1 || conflicts.length !== 1) {
    context.blockers.push({
      actual: hashJson(attempts.map((result) => result.status).sort()),
      criterion: "parallel_4_to_5",
      expected: hashJson([201, 409]),
    })
  }
  if (successes[0]) {
    const intent = successes[0].body.data
    context.database.trackObject(intent.objectName)
    const bytes = intent.objectName.endsWith(".jpg") ? createTinyJpeg() : createTinyWebp()
    const mimeType = intent.objectName.endsWith(".jpg") ? "image/jpeg" : "image/webp"
    const uploaded = await uploadSigned(context.clients.coach, intent, bytes, mimeType)
    if (uploaded.error) throw new Error("4-to-5 winning upload failed")
    const registered = await registerIntent(context, raceLesson, "coach", intent)
    expectStatus(context, "parallel_4_to_5_register", registered, 201)
  }
  const images = await context.database.readImages(raceLesson)
  if (images.length !== 5) {
    context.blockers.push({
      actual: images.length,
      criterion: "parallel_4_to_5_final_count",
      expected: 5,
    })
  }
}
