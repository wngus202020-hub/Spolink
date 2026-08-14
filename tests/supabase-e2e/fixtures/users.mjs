export const fixtureUsers = Object.freeze([
  {
    key: "learner",
    email: "learner@spolink.test",
    role: "learner",
    status: "active",
    displayName: "E2E Learner",
  },
  {
    key: "otherLearner",
    email: "other-learner@spolink.test",
    role: "learner",
    status: "active",
    displayName: "E2E Other Learner",
  },
  {
    key: "coach",
    email: "coach@spolink.test",
    role: "coach",
    status: "coach_approved",
    displayName: "E2E Coach",
  },
  {
    key: "pendingCoach",
    email: "pending-coach@spolink.test",
    role: "coach",
    status: "pending_coach",
    displayName: "E2E Pending Coach",
  },
  {
    key: "admin",
    email: "admin@spolink.test",
    role: "admin",
    status: "active",
    displayName: "E2E Admin",
  },
])

export const fixtureEmails = fixtureUsers.map((user) => user.email)
