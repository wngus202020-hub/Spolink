import { createTinyJpeg, createTinyPng, createTinyWebp } from "../image-fixtures.mjs"

export const MIME_FIXTURES = [
  ["image/jpeg", createTinyJpeg],
  ["image/png", createTinyPng],
  ["image/webp", createTinyWebp],
]
