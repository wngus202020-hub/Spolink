type CoachDashboardInjectionEnvironment = Readonly<Record<string, string | undefined>>

export function shouldInjectCoachDashboardFailure(
  environment: CoachDashboardInjectionEnvironment,
): boolean {
  return (
    environment["SPOLINK_COACH_DASHBOARD_INJECT_FAILURE"] === "after-seed" &&
    environment["SPOLINK_COACH_DASHBOARD_RUNNER_CONTRACT"] === "1"
  )
}
