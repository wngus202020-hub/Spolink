import type { CoachDashboardFixturePlan } from "./coach-dashboard-fixture-plan"

type IdReader = (alias: string) => string

export function buildDashboardNotifications(
  id: IdReader,
  at: (hours: number) => string,
  reservationId: IdReader,
  paymentId: IdReader,
): CoachDashboardFixturePlan["graph"]["notifications"] {
  const definitions = [
    ["owner-unread-latest-1", "approved-owner", false, 9, "OWNER_NOTICE_ALPHA"],
    ["owner-unread-latest-2", "approved-owner", false, 8, "OWNER_NOTICE_BETA"],
    ["owner-unread-latest-3", "approved-owner", false, 7, "OWNER_NOTICE_GAMMA"],
    ["owner-unread-old-counted", "approved-owner", false, 6, "OWNER_NOTICE_OLD_EXCLUDED"],
    ["owner-read-excluded", "approved-owner", true, 10, "READ_NOTICE_SENTINEL"],
    ["foreign-unread", "foreign-coach", false, 11, "FOREIGN_NOTICE_SENTINEL"],
  ] as const
  return definitions.map(([alias, owner, read, hours, title]) => {
    const source = owner === "approved-owner" ? "owner-confirmed-1" : "foreign-confirmed"
    return {
      alias,
      body: `${title}_BODY`,
      createdAt: at(hours),
      id: id(`notification-${alias}`),
      owner,
      payment: paymentId(source),
      read,
      reservation: reservationId(source),
      title,
    }
  })
}

export function buildDashboardSettlements(
  id: IdReader,
  reservationId: IdReader,
  paymentId: IdReader,
): CoachDashboardFixturePlan["graph"]["settlements"] {
  const definitions = [
    ["owner-pending-1", "approved-owner", "pending", 8500, "owner-confirmed-1"],
    ["owner-pending-2", "approved-owner", "pending", 17000, "owner-confirmed-2"],
    ["owner-hold-excluded", "approved-owner", "hold", 7000, "owner-confirmed-3"],
    ["foreign-pending", "foreign-coach", "pending", 99000, "foreign-confirmed"],
  ] as const
  return definitions.map(([alias, owner, status, netAmount, source]) => ({
    alias,
    id: id(`settlement-${alias}`),
    netAmount,
    owner,
    payment: paymentId(source),
    reservation: reservationId(source),
    status,
  }))
}

export function buildDashboardPersonas(): CoachDashboardFixturePlan["personas"] {
  return [
    { accountState: "coach_approved", alias: "approved-owner", coachState: "approved" },
    { accountState: "coach_approved", alias: "empty-coach", coachState: "approved" },
    { accountState: "coach_approved", alias: "foreign-coach", coachState: "approved" },
    { accountState: "active", alias: "profile-required", coachState: null },
    { accountState: "active", alias: "active-learner", coachState: null },
    { accountState: "active", alias: "applicant-draft", coachState: "draft" },
    { accountState: "pending_coach", alias: "applicant-submitted", coachState: "submitted" },
    { accountState: "active", alias: "applicant-rejected", coachState: "rejected" },
    { accountState: "suspended", alias: "restricted-suspended", coachState: null },
    { accountState: "deleted", alias: "restricted-deleted", coachState: null },
    { accountState: "active", alias: "learner-reviewer", coachState: null },
  ]
}
