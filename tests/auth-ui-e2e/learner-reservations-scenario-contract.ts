export const reservationTestTitles = {
  unauthenticated: "unauthenticated My Page reservation routes preserve safe next paths",
  learner: "learner views owned reservation filters and guarded details without mutations",
} as const

export const reservationPhaseNames = {
  authSessions: "3 Auth sessions",
  fixtureSeed: "cleanup/seed",
  learnerActivation: "learner activation",
  myPageDocument: "/mypage document request/response",
  myPageReadModel: "SSR profile/read model/heading",
  reservationNavigation: "nav/filter/detail",
  completionSuccess: "completion success/read-only routes",
  completionRecovery: "completion recovery/not-found routes",
  cleanup: "cleanup",
} as const

type PhaseActions<Sessions, Fixture> = Readonly<{
  authSessions: () => Promise<Sessions>
  cleanup: () => Promise<void>
  completionRecovery: () => Promise<void>
  completionSuccess: (fixture: Fixture) => Promise<void>
  fixtureSeed: (sessions: Sessions) => Promise<Fixture>
  learnerActivation: (sessions: Sessions) => Promise<void>
  myPageDocument: () => Promise<void>
  myPageReadModel: () => Promise<void>
  reservationNavigation: () => Promise<void>
}>

type PhaseRunner = <Result>(name: string, action: () => Promise<Result>) => Promise<Result>

type ReservationPhasePlan<Sessions, Fixture> = Readonly<{
  actions: PhaseActions<Sessions, Fixture>
  runPhase: PhaseRunner
}>

export async function runLearnerReservationPhases<Sessions, Fixture>({
  actions,
  runPhase,
}: ReservationPhasePlan<Sessions, Fixture>) {
  try {
    const sessions = await runPhase(reservationPhaseNames.authSessions, actions.authSessions)
    const fixture = await runPhase(reservationPhaseNames.fixtureSeed, () =>
      actions.fixtureSeed(sessions),
    )
    await runPhase(reservationPhaseNames.learnerActivation, () =>
      actions.learnerActivation(sessions),
    )
    await runPhase(reservationPhaseNames.myPageDocument, actions.myPageDocument)
    await runPhase(reservationPhaseNames.myPageReadModel, actions.myPageReadModel)
    await runPhase(reservationPhaseNames.reservationNavigation, actions.reservationNavigation)
    await runPhase(reservationPhaseNames.completionSuccess, () =>
      actions.completionSuccess(fixture),
    )
    await runPhase(reservationPhaseNames.completionRecovery, actions.completionRecovery)
  } finally {
    await runPhase(reservationPhaseNames.cleanup, actions.cleanup)
  }
}
