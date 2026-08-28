import { callCancellation, callLifecycle, callPayment, slot, userClient } from "./live-helpers.mjs"
import { completedState, confirmedPaymentState, learnerNoShowState } from "./race-state.mjs"

export function lifecycleRaceScenarios(runtime) {
  const coach = userClient(runtime.clients, "coach")
  const admin = userClient(runtime.clients, "admin")
  const learner = userClient(runtime.clients, "learner")
  return [
    lifecycleScenario({
      expectedState: completedState(),
      first: () => callLifecycle(coach, slot("310", "410", "510").reservationId, "complete"),
      name: "related-coach-vs-active-admin-complete-replay",
      second: () => callLifecycle(admin, slot("310", "410", "510").reservationId, "complete"),
      slot: slot("310", "410", "510"),
      statusPair: [null, null],
      winner: "first",
    }),
    lifecycleScenario({
      expectedState: completedState(),
      first: () => callLifecycle(coach, slot("311", "411", "511").reservationId, "complete"),
      name: "complete-vs-learner-no-show",
      noShowAvailable: true,
      second: () =>
        callLifecycle(
          admin,
          slot("311", "411", "511").reservationId,
          "mark_learner_no_show",
          "learner absent",
        ),
      slot: slot("311", "411", "511"),
      statusPair: [null, "P0001"],
      winner: "first",
    }),
    lifecycleScenario({
      expectedState: completedState(),
      first: () => callLifecycle(coach, slot("312", "412", "512").reservationId, "complete"),
      name: "complete-vs-coach-no-show",
      noShowAvailable: true,
      second: () =>
        callLifecycle(
          admin,
          slot("312", "412", "512").reservationId,
          "mark_coach_no_show",
          "coach absent",
        ),
      slot: slot("312", "412", "512"),
      statusPair: [null, "P0001"],
      winner: "first",
    }),
    lifecycleScenario({
      expectedState: completedState(),
      first: () => callLifecycle(coach, slot("313", "413", "513").reservationId, "complete"),
      name: "complete-vs-cancellation",
      second: () =>
        callCancellation(learner, slot("313", "413", "513").reservationId, "race cancel"),
      secondFunction: "cancel_reservation",
      slot: slot("313", "413", "513"),
      statusPair: [null, "P0001"],
      winner: "first",
    }),
    lifecycleScenario({
      expectedState: confirmedPaymentState(),
      first: () => callLifecycle(coach, slot("322", "422", "522").reservationId, "complete"),
      name: "complete-vs-payment-confirmation",
      second: () => callPayment(runtime.serviceClient, slot("322", "422", "522")),
      secondFunction: "confirm_paid_reservation",
      slot: slot("322", "422", "522"),
      statusPair: ["P0001", null],
      winner: "second",
    }),
    lifecycleScenario({
      expectedState: learnerNoShowState("normalized reason"),
      first: () =>
        callLifecycle(
          coach,
          slot("315", "415", "515").reservationId,
          "mark_learner_no_show",
          "  normalized reason  ",
        ),
      name: "same-action-normalized-same-reason",
      noShowAvailable: true,
      second: () =>
        callLifecycle(
          admin,
          slot("315", "415", "515").reservationId,
          "mark_learner_no_show",
          "normalized reason",
        ),
      slot: slot("315", "415", "515"),
      statusPair: [null, null],
      winner: "first",
    }),
    lifecycleScenario({
      expectedState: learnerNoShowState("original reason"),
      first: () =>
        callLifecycle(
          coach,
          slot("310", "410", "510").reservationId,
          "mark_learner_no_show",
          "original reason",
        ),
      name: "same-action-different-reason",
      noShowAvailable: true,
      second: () =>
        callLifecycle(
          admin,
          slot("310", "410", "510").reservationId,
          "mark_learner_no_show",
          "different reason",
        ),
      slot: slot("310", "410", "510"),
      statusPair: [null, "23505"],
      winner: "first",
    }),
  ]
}

function lifecycleScenario(options) {
  return {
    firstFunction: "transition_reservation_lifecycle",
    functions: {
      first: "transition_reservation_lifecycle",
      second: options.secondFunction ?? "transition_reservation_lifecycle",
    },
    noShowAvailable: false,
    secondFunction: options.secondFunction ?? "transition_reservation_lifecycle",
    ...options,
  }
}
