import { notification, review, schedule } from "./coach-dashboard-read-model.harness.mjs"

export const dashboardRows = Object.freeze({
  lesson_schedules: Object.freeze([
    schedule("schedule-late", "2026-08-29T03:00:00.000Z", { lesson_id: "lesson-second" }),
    schedule("schedule-first", "2026-08-28T16:00:00.000Z"),
    schedule("schedule-foreign", "2026-08-28T15:30:00.000Z", {
      lesson_id: "lesson-foreign",
    }),
  ]),
  lessons: Object.freeze([
    Object.freeze({ coach_profile_id: "coach-owned", id: "lesson-owned", title: "테니스 입문" }),
    Object.freeze({ coach_profile_id: "coach-owned", id: "lesson-second", title: "주말 러닝" }),
    Object.freeze({ coach_profile_id: "coach-foreign", id: "lesson-foreign", title: "외부 레슨" }),
  ]),
  notifications: Object.freeze([
    notification("owned-unread-1", "2026-08-29T04:00:00.000Z"),
    notification("owned-unread-2", "2026-08-29T03:00:00.000Z"),
    notification("owned-unread-3", "2026-08-29T02:00:00.000Z"),
    notification("owned-unread-4", "2026-08-29T01:00:00.000Z"),
    notification("owned-read", "2026-08-29T05:00:00.000Z", {
      read_at: "2026-08-29T05:30:00.000Z",
    }),
    notification("foreign-unread", "2026-08-29T06:00:00.000Z", { user_id: "profile-foreign" }),
  ]),
  reservations: Object.freeze([
    Object.freeze({
      coach_profile_id: "coach-owned",
      learner_email: "learner@example.test",
      status: "pending_payment",
    }),
    Object.freeze({
      coach_profile_id: "coach-owned",
      learner_phone: "010-0000-0000",
      status: "confirmed",
    }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "cancelled_by_user" }),
    Object.freeze({ coach_profile_id: "coach-foreign", status: "confirmed" }),
  ]),
  reviews: Object.freeze([
    review("visible-1", "2026-08-29T04:00:00.000Z"),
    review("visible-2", "2026-08-29T03:00:00.000Z", { lesson_id: "lesson-second" }),
    review("visible-3", "2026-08-29T02:00:00.000Z"),
    review("visible-4", "2026-08-29T01:00:00.000Z"),
    review("hidden", "2026-08-29T05:00:00.000Z", { status: "hidden" }),
    review("deleted", "2026-08-29T06:00:00.000Z", { status: "deleted" }),
    review("foreign", "2026-08-29T07:00:00.000Z", { coach_profile_id: "coach-foreign" }),
  ]),
  settlements: Object.freeze([
    Object.freeze({
      coach_profile_id: "coach-owned",
      gross_amount: 15000,
      net_amount: 12000,
      status: "pending",
    }),
    Object.freeze({
      coach_profile_id: "coach-owned",
      gross_amount: 25000,
      net_amount: 21000,
      status: "pending",
    }),
    Object.freeze({ coach_profile_id: "coach-owned", net_amount: 8000, status: "hold" }),
    Object.freeze({ coach_profile_id: "coach-owned", net_amount: 7000, status: "approved" }),
    Object.freeze({ coach_profile_id: "coach-owned", net_amount: 6000, status: "paid" }),
    Object.freeze({ coach_profile_id: "coach-owned", net_amount: 5000, status: "failed" }),
    Object.freeze({ coach_profile_id: "coach-foreign", net_amount: 99000, status: "pending" }),
  ]),
})

export const expectedDashboard = Object.freeze({
  notifications: {
    items: [
      {
        body: "owned-unread-1-body",
        createdAt: "2026-08-29T04:00:00.000Z",
        title: "owned-unread-1",
      },
      {
        body: "owned-unread-2-body",
        createdAt: "2026-08-29T03:00:00.000Z",
        title: "owned-unread-2",
      },
      {
        body: "owned-unread-3-body",
        createdAt: "2026-08-29T02:00:00.000Z",
        title: "owned-unread-3",
      },
    ],
    unreadCount: 4,
  },
  pendingSettlements: { count: 2, totalNetAmount: 33000 },
  recentReviews: [
    {
      content: "visible-1",
      createdAt: "2026-08-29T04:00:00.000Z",
      lessonTitle: "테니스 입문",
      rating: 5,
    },
    {
      content: "visible-2",
      createdAt: "2026-08-29T03:00:00.000Z",
      lessonTitle: "주말 러닝",
      rating: 5,
    },
    {
      content: "visible-3",
      createdAt: "2026-08-29T02:00:00.000Z",
      lessonTitle: "테니스 입문",
      rating: 5,
    },
  ],
  reservations: {
    completionPending: 1,
    confirmed: 1,
    labels: { confirmed: "예약 확정", pending_payment: "결제 대기" },
    pendingPayment: 1,
  },
  todaySchedules: [
    {
      capacity: 4,
      endsAt: "2026-08-29T05:00:00.000Z",
      isOpen: true,
      lessonTitle: "테니스 입문",
      reservedCount: 1,
      startsAt: "2026-08-28T16:00:00.000Z",
    },
    {
      capacity: 4,
      endsAt: "2026-08-29T05:00:00.000Z",
      isOpen: true,
      lessonTitle: "주말 러닝",
      reservedCount: 1,
      startsAt: "2026-08-29T03:00:00.000Z",
    },
  ],
})

export const expectedTrace = Object.freeze([
  {
    filters: [{ column: "coach_profile_id", kind: "eq", value: "coach-owned" }],
    limit: null,
    orders: [],
    select: { columns: "id,title", options: null },
    table: "lessons",
  },
  {
    filters: [
      { column: "lesson_id", kind: "in", values: ["lesson-owned", "lesson-second"] },
      { column: "starts_at", kind: "gte", value: "2026-08-28T15:00:00.000Z" },
      { column: "starts_at", kind: "lt", value: "2026-08-29T15:00:00.000Z" },
    ],
    limit: 8,
    orders: [
      { ascending: true, column: "starts_at" },
      { ascending: true, column: "id" },
    ],
    select: {
      columns: "capacity,ends_at,id,is_open,lesson_id,reserved_count,starts_at",
      options: null,
    },
    table: "lesson_schedules",
  },
  {
    filters: [
      { column: "coach_profile_id", kind: "eq", value: "coach-owned" },
      { column: "status", kind: "in", values: ["pending_payment", "confirmed"] },
    ],
    limit: null,
    orders: [],
    select: { columns: "status", options: null },
    table: "reservations",
  },
  {
    filters: [
      { column: "coach_profile_id", kind: "eq", value: "coach-owned" },
      { column: "status", kind: "eq", value: "pending" },
    ],
    limit: null,
    orders: [],
    select: { columns: "net_amount", options: null },
    table: "settlements",
  },
  {
    filters: [
      { column: "coach_profile_id", kind: "eq", value: "coach-owned" },
      { column: "status", kind: "eq", value: "visible" },
    ],
    limit: 3,
    orders: [
      { ascending: false, column: "created_at" },
      { ascending: false, column: "id" },
    ],
    select: { columns: "rating,content,created_at,lesson_id", options: null },
    table: "reviews",
  },
  {
    filters: [
      { column: "user_id", kind: "eq", value: "profile-owned" },
      { column: "read_at", kind: "is", value: null },
    ],
    limit: 3,
    orders: [
      { ascending: false, column: "created_at" },
      { ascending: false, column: "id" },
    ],
    select: { columns: "title,body,created_at", options: { count: "exact" } },
    table: "notifications",
  },
])
