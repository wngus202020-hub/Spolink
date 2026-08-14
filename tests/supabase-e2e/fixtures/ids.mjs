export const idPrefix = "00000000-0000-4000-8000-00000000"

export const fixedIds = Object.freeze({
  lesson: `${idPrefix}0101`,
  approvedCoachProfile: `${idPrefix}0201`,
  pendingCoachProfile: `${idPrefix}0202`,
  baselineOpenSchedule: `${idPrefix}0301`,
  baselineClosedSchedule: `${idPrefix}0302`,
  historyReservation: `${idPrefix}0401`,
  cancellableReservation: `${idPrefix}0402`,
  historyPayment: `${idPrefix}0501`,
  cancellablePayment: `${idPrefix}0502`,
  historyRefund: `${idPrefix}0601`,
})

export function expandFixedId(suffix) {
  return `${idPrefix}0${suffix}`
}
