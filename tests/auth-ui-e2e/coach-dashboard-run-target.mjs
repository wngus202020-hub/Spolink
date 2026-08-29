import {
  isCoachDashboardVisualGrep,
  visualScreenshotNames,
} from "./coach-dashboard-visual-artifacts.mjs"

const desktopProject = "desktop-chromium"
const focusedBasicScreenshotCount = 1
const fullBasicScreenshotCount = 7

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

export function resolveCoachDashboardRunShape(target) {
  if (target.variant === "full") {
    return {
      expectedFixtureRuns: 3,
      expectedScreenshots: fullBasicScreenshotCount,
      projects: [desktopProject],
    }
  }
  if (target.variant === "visual-responsive") {
    return {
      expectedFixtureRuns: 3,
      expectedScreenshots: visualScreenshotNames.length,
      projects: [desktopProject, "mobile-chromium", "tablet-chromium"],
    }
  }
  if (target.variant === "populated-navigation" || target.variant === "redirect-ownership") {
    return {
      expectedFixtureRuns: 1,
      expectedScreenshots: focusedBasicScreenshotCount,
      projects: [desktopProject],
    }
  }
  throw new Error("Unsupported coach dashboard run target")
}
