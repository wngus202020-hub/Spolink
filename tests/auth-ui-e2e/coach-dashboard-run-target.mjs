import { isCoachDashboardVisualGrep } from "./coach-dashboard-visual-artifacts.mjs"

export function resolveCoachDashboardRunTarget(grep) {
  if (isCoachDashboardVisualGrep(grep)) {
    const root = ".omo/evidence/coach-dashboard-screen/task-8"
    return {
      outputPath: `${root}/task-8-coach-dashboard-screen.json`,
      root,
      variant: "visual-responsive",
      visualDir: `${root}/screenshots`,
    }
  }
  const variant =
    grep?.includes("redirect") || grep?.includes("ownership")
      ? "redirect-ownership"
      : grep?.includes("populated") || grep?.includes("navigation")
        ? "populated-navigation"
        : "full"
  const root = ".omo/evidence/coach-dashboard-screen/task-7"
  return {
    outputPath: `${root}/${variant}.json`,
    root,
    variant,
    visualDir: `${root}/${variant}-visual`,
  }
}
