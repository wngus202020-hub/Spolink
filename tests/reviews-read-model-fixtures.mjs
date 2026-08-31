export function review(overrides = {}) {
  return {
    coachProfileId: "coach-owned",
    content: "친절하고 알찬 수업이었습니다.",
    createdAt: "2026-08-30T15:00:00.000Z",
    hiddenReason: null,
    id: "review-visible",
    lessonId: "lesson-owned",
    rating: 5,
    status: "visible",
    ...overrides,
  }
}

export function lesson(overrides = {}) {
  return {
    coachProfileId: "coach-owned",
    id: "lesson-owned",
    status: "active",
    title: "입문 테니스 레슨",
    ...overrides,
  }
}

export function coach(overrides = {}) {
  return { id: "coach-owned", status: "approved", ...overrides }
}

export function found(overrides = {}) {
  return {
    coaches: [coach()],
    kind: "found",
    lessons: [lesson()],
    reviews: [review()],
    totalCount: 1,
    ...overrides,
  }
}
