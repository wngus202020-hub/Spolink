import { expandFixedId, fixedIds } from "./ids.mjs"

export const policySlots = [
  paidScenario("310", "410", "510", 25, "local-seed-410"),
  paidScenario("311", "411", "511", 4, "local-seed-411"),
  paidScenario("312", "412", "512", 2, "local-seed-412"),
  paidScenario("313", "413", "513", 25, "local-seed-413"),
  readyScenario("314", "414", "514"),
  paidScenario("315", "415", "515", 25, "local-seed-415"),
]

export const raceSlots = [
  paidScenario("320", "420", "520", 25, "local-seed-420"),
  paidScenario("321", "421", "521", 25, "local-seed-421"),
  readyScenario("322", "422", "522"),
  readyScenario("323", "423", "523"),
  readyScenario("324", "424", "524"),
]

export function fixedReservationIds() {
  return [
    fixedIds.historyReservation,
    fixedIds.cancellableReservation,
    ...policySlots.map((slot) => expandFixedId(slot.reservation)),
    ...raceSlots.map((slot) => expandFixedId(slot.reservation)),
  ]
}

export function fixedPaymentIds() {
  return [
    fixedIds.historyPayment,
    fixedIds.cancellablePayment,
    ...policySlots.map((slot) => expandFixedId(slot.payment)),
    ...raceSlots.map((slot) => expandFixedId(slot.payment)),
  ]
}

export function fixedScheduleIds() {
  return [
    fixedIds.baselineOpenSchedule,
    fixedIds.baselineClosedSchedule,
    ...policySlots.map((slot) => expandFixedId(slot.suffix)),
    ...raceSlots.map((slot) => expandFixedId(slot.suffix)),
  ]
}

function paidScenario(suffix, reservation, payment, startsInHours, providerKey) {
  return {
    suffix,
    reservation,
    payment,
    startsInHours,
    status: "confirmed",
    paymentStatus: "paid",
    reservedCount: 1,
    providerKey,
  }
}

function readyScenario(suffix, reservation, payment) {
  return {
    suffix,
    reservation,
    payment,
    startsInHours: 25,
    status: "pending_payment",
    paymentStatus: "ready",
    reservedCount: 0,
    providerKey: null,
  }
}
