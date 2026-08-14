const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type PreparedPayment = Readonly<{
  amount: number
  orderName: string
  paymentId: string
  provider: "toss"
  providerOrderId: string
}>

export type PreparePaymentClientErrorCode =
  | "UNAUTHORIZED"
  | "PROFILE_REQUIRED"
  | "RESERVATION_EXPIRED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"

export type PreparePaymentClientResult = Readonly<
  | {
      payment: PreparedPayment
      status: "success"
    }
  | {
      code: PreparePaymentClientErrorCode
      message: string
      status: "failure"
    }
>

type PaymentPrepareFetch = (
  input: string,
  init: RequestInit & { headers: Record<string, string> },
) => Promise<Response>

export async function preparePayment(
  reservationId: string,
  fetcher: PaymentPrepareFetch = fetch,
): Promise<PreparePaymentClientResult> {
  let response: Response

  try {
    response = await fetcher("/api/payments/prepare", {
      body: JSON.stringify({ reservationId }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  } catch {
    return failure("NETWORK_ERROR")
  }

  const body = await readJson(response)

  if (!response.ok) {
    const code = readMappedErrorCode(body)
    return failure(code ?? "INVALID_RESPONSE")
  }

  const payment = readPreparedPayment(body)

  return payment ? { payment, status: "success" } : failure("INVALID_RESPONSE")
}

function failure(code: PreparePaymentClientErrorCode): PreparePaymentClientResult {
  return { code, message: messageForCode(code), status: "failure" }
}

function messageForCode(code: PreparePaymentClientErrorCode) {
  if (code === "UNAUTHORIZED") return "로그인이 필요해요. 다시 로그인해요."
  if (code === "PROFILE_REQUIRED") return "프로필 설정을 완료한 뒤 결제를 준비해요."
  if (code === "RESERVATION_EXPIRED") return "결제 시간이 만료됐어요. 다시 예약해요."
  if (code === "NOT_FOUND") return "예약 정보를 찾지 못했어요."
  if (code === "FORBIDDEN") return "이 예약의 결제를 준비할 권한이 없어요."
  if (code === "CONFLICT") return "예약 또는 결제 상태가 변경됐어요. 다시 확인해요."
  if (code === "NETWORK_ERROR") return "연결이 원활하지 않아요. 잠시 후 다시 시도해요."

  return "결제 준비 응답을 확인하지 못했어요. 다시 시도해요."
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function readMappedErrorCode(value: unknown): PreparePaymentClientErrorCode | null {
  if (!isRecord(value)) return null
  const error = value["error"]
  if (!isRecord(error)) return null
  const code = error["code"]

  if (
    code === "UNAUTHORIZED" ||
    code === "PROFILE_REQUIRED" ||
    code === "RESERVATION_EXPIRED" ||
    code === "NOT_FOUND" ||
    code === "FORBIDDEN" ||
    code === "CONFLICT"
  ) {
    return code
  }

  return null
}

function readPreparedPayment(value: unknown): PreparedPayment | null {
  if (!isRecord(value)) return null
  const data = value["data"]
  if (!isRecord(data)) return null
  const amount = data["amount"]
  const orderName = data["orderName"]
  const paymentId = data["paymentId"]
  const provider = data["provider"]
  const providerOrderId = data["providerOrderId"]

  if (
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    typeof orderName !== "string" ||
    orderName.trim().length === 0 ||
    typeof paymentId !== "string" ||
    !uuidPattern.test(paymentId) ||
    provider !== "toss" ||
    typeof providerOrderId !== "string" ||
    providerOrderId.trim().length === 0
  ) {
    return null
  }

  return { amount, orderName, paymentId, provider, providerOrderId }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
