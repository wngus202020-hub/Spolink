import assert from "node:assert/strict"
import { createServer } from "node:http"
import test from "node:test"

import { createTossPaymentVerifier } from "../lib/payments/toss-payment-verifier.ts"

const request = Object.freeze({
  amount: 50000,
  providerOrderId: "spolink_00000000-0000-4000-8000-000000000401",
  providerPaymentKey: "payment-key",
  reservationId: "00000000-0000-4000-8000-000000000401",
})

test("Toss verifier accepts only DONE responses that match key, order, and amount", async () => {
  const server = await createJsonServer({
    orderId: request.providerOrderId,
    paymentKey: request.providerPaymentKey,
    status: "DONE",
    totalAmount: request.amount,
  })

  try {
    const verifyPayment = createTossPaymentVerifier("test-secret", server.url)
    const result = await verifyPayment(request)

    assert.equal(result.status, "success")
  } finally {
    await server.close()
  }
})

test("Toss verifier rejects non-DONE responses even when key, order, and amount match", async () => {
  const server = await createJsonServer({
    orderId: request.providerOrderId,
    paymentKey: request.providerPaymentKey,
    status: "WAITING_FOR_DEPOSIT",
    totalAmount: request.amount,
  })

  try {
    const verifyPayment = createTossPaymentVerifier("test-secret", server.url)
    const result = await verifyPayment(request)

    assert.deepEqual(result, {
      status: "failure",
      type: "verification_failed",
    })
  } finally {
    await server.close()
  }
})

function createJsonServer(responseBody) {
  const server = createServer((_, response) => {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify(responseBody))
  })

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()

      assert.ok(typeof address === "object" && address !== null)

      resolve({
        close: () => new Promise((closeResolve) => server.close(closeResolve)),
        url: `http://127.0.0.1:${address.port}`,
      })
    })
  })
}
