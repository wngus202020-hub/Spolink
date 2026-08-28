import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  lessonDraftSchema,
  lessonTransitionSchema,
  scheduleCreateSchema,
} from "../lib/lessons/authoring-contract.ts"

test("Given strict authoring schemas, when unsafe fields and malformed times arrive, then parsing fails", () => {
  // Given
  const validDraft = {
    capacity: 4,
    description: "초보자를 위한 안전한 테니스 수업입니다.",
    durationMinutes: 60,
    priceAmount: 50000,
    region: "서울 강남구",
    sportId: "00000000-0000-4000-8000-000000000101",
    title: "테니스 입문 레슨",
  }

  // When
  const clientOwnedStatus = lessonDraftSchema.safeParse({ ...validDraft, status: "active" })
  const reversedTime = scheduleCreateSchema.safeParse({
    capacity: 4,
    endsAt: "2026-08-20T01:00:00+09:00",
    startsAt: "2026-08-20T02:00:00+09:00",
  })
  const invalidAction = lessonTransitionSchema.safeParse({
    action: "active",
    expectedUpdatedAt: "2026-08-14T14:00:00+09:00",
  })

  // Then
  assert.equal(clientOwnedStatus.success, false)
  assert.equal(reversedTime.success, false)
  assert.equal(invalidAction.success, false)
})

test("Given the forward migration, when its lifecycle boundary is inspected, then locks and grants are explicit", async () => {
  // Given
  const migration = await readFile(
    "supabase/migrations/20260814020000_add_lesson_authoring_lifecycle.sql",
    "utf8",
  )

  // When
  const normalized = migration.toLowerCase()

  // Then
  assert.match(normalized, /create or replace function public\.transition_lesson/u)
  assert.match(normalized, /from public\.lesson_schedules[\s\S]*for update/u)
  assert.match(normalized, /schedule_has_confirmed_reservation/u)
  assert.match(normalized, /checked_lesson_id uuid,[\s\S]*checked_schedule_id uuid/u)
  assert.match(normalized, /grant execute on function public\.close_lesson_schedule/u)
  assert.doesNotMatch(normalized, /profiles\.role = 'coach'/u)
})
