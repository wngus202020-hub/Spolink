"use client"

import CoachDashboardRecoveryView from "./coach-dashboard-recovery-view"

type Props = Readonly<{
  error: Error
  reset: () => void
}>

export default function CoachDashboardError({ error, reset }: Props) {
  void error
  return <CoachDashboardRecoveryView onRetry={reset} />
}
