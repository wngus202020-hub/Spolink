export const finalQaHypotheses = Object.freeze([
  "stale/chunked cookies lose session",
  "parallel recovery requests reuse a grant",
  "confirmation-mode restart leaks config/process state",
])

export const finalQaScenarioNames = Object.freeze([
  "login",
  "signup",
  "onboarding",
  "hard refresh",
  "logout",
  "reset recovery",
  "confirmation callback",
  "restricted account",
  "direct booking",
  "failure paths",
])

export const finalQaProjects = Object.freeze(["desktop-chromium", "mobile-chromium"])

export const authSignupJourneyTitlesByMode = Object.freeze({
  false: "confirmation-off real signup persists profile and supports password re-login",
  true: "confirmation-on real signup confirms email, persists profile, and supports password re-login",
})

export const namedSecurityTestFiles = Object.freeze([
  "tests/auth-ui-e2e/redirect-proxy.test.mjs",
  "tests/auth-ui-e2e/session-routes.test.mjs",
  "tests/auth-ui-e2e/profile-api.test.mjs",
  "tests/auth-ui-e2e/commerce-auth.test.mjs",
])
