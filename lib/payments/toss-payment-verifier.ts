import ky, { HTTPError } from "ky"
import { z } from "zod"
import type {
  ConfirmPaymentRequest,
  ProviderPaymentVerificationResult,
} from "@/lib/payments/confirm-payment-api"
import type { Json } from "@/lib/supabase/database.types"

const tossConfirmResponseSchema = z.object({
  orderId: z.string(),
  paymentKey: z.string(),
  status: z.string(),
  totalAmount: z.number().int().nonnegative(),
})

const tossConfirmUrl = "https://api.tosspayments.com/v1/payments/confirm"

export function createTossPaymentVerifier(secretKey: string, endpoint = tossConfirmUrl) {
  return async function verifyProviderPayment(
    request: ConfirmPaymentRequest,
  ): Promise<ProviderPaymentVerificationResult> {
    try {
      const response = await ky
        .post(endpoint, {
          headers: {
            Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
          },
          json: {
            amount: request.amount,
            orderId: request.providerOrderId,
            paymentKey: request.providerPaymentKey,
          },
          timeout: 10_000,
        })
        .json<unknown>()

      const parsedResponse = tossConfirmResponseSchema.safeParse(response)

      if (
        !parsedResponse.success ||
        !matchesRequest(parsedResponse.data, request) ||
        parsedResponse.data.status !== "DONE"
      ) {
        return { status: "failure", type: "verification_failed" }
      }

      return {
        rawPayload: buildTossRawPayload(parsedResponse.data),
        status: "success",
      }
    } catch (error) {
      if (error instanceof HTTPError) {
        return {
          status: "failure",
          type: error.response.status < 500 ? "verification_failed" : "provider_error",
        }
      }

      return { status: "failure", type: "provider_error" }
    }
  }
}

function matchesRequest(
  response: z.infer<typeof tossConfirmResponseSchema>,
  request: ConfirmPaymentRequest,
) {
  return (
    response.paymentKey === request.providerPaymentKey &&
    response.orderId === request.providerOrderId &&
    response.totalAmount === request.amount
  )
}

function buildTossRawPayload(response: z.infer<typeof tossConfirmResponseSchema>): Json {
  return {
    orderId: response.orderId,
    paymentKey: response.paymentKey,
    status: response.status,
    totalAmount: response.totalAmount,
  }
}
