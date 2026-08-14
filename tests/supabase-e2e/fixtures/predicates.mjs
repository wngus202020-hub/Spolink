import { fixedPaymentIds, fixedReservationIds } from "./slots.mjs"

export function generatedSideEffectPredicates(profileIds) {
  return {
    refundReservationIds: fixedReservationIds(),
    refundPaymentIds: fixedPaymentIds(),
    notificationUserIds: profileIds,
    notificationReservationIds: fixedReservationIds(),
    auditTargetIds: [...fixedReservationIds(), ...fixedPaymentIds()],
    auditActorIds: profileIds,
  }
}
