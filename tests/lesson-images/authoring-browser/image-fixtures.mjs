import { readFile } from "node:fs/promises"

const fixtureNames = [
  "lesson-tennis.webp",
  "lesson-pilates.webp",
  "lesson-running.webp",
  "lesson-tennis.webp",
  "lesson-pilates.webp",
]

export async function readImageFixtures() {
  return Promise.all(fixtureNames.map((name) => readFile(`public/images/${name}`)))
}

export function filePayload(name, buffer) {
  return { buffer, mimeType: "image/webp", name }
}
