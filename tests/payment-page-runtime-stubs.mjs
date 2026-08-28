import { createElement } from "react"

let prepareResult = {
  payment: {
    amount: 50_000,
    orderName: "입문 테니스 레슨",
    paymentId: "payment-contract-id",
    provider: "toss",
    providerOrderId: "order-contract-id",
  },
  status: "success",
}
let prepareCalls = []
let routerPushes = []
let stateUpdates = []

export default function Link({ children, href, ...props }) {
  return createElement("a", { ...props, href }, children)
}

export function PublicHeader({ auth }) {
  return createElement("header", { "data-auth-kind": auth.kind }, "SPOLINK")
}

export async function preparePayment(reservationId) {
  prepareCalls.push(reservationId)
  return prepareResult
}

export function redirect(path) {
  throw new Error(`Unexpected production redirect: ${path}`)
}

export function resetPaymentRuntimeStubs() {
  prepareCalls = []
  routerPushes = []
  stateUpdates = []
}

export function readPaymentRuntimeEvents() {
  return {
    prepareCalls: [...prepareCalls],
    routerPushes: [...routerPushes],
    stateUpdates: [...stateUpdates],
  }
}

export function setPrepareResult(result) {
  prepareResult = result
}

export function useEffect() {}

export function useRef(initialValue) {
  return { current: initialValue }
}

export function useRouter() {
  return { push: (path) => routerPushes.push(path) }
}

export function useState(initialValue) {
  return [initialValue, (value) => stateUpdates.push(value)]
}
