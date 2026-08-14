const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type BookingReservationRequest = Readonly<{
  lessonId: string
  lessonScheduleId: string
}>

export type BookingReservation = Readonly<{
  id: string
  paymentExpiresAt: string
  reservedPriceAmount: number
  status: "pending_payment"
}>

export type BookingReservationResult = Readonly<
  | {
      paymentHref: string
      reservation: BookingReservation
      status: "success"
    }
  | {
      code: string
      message: string
      status: "failure"
    }
>

type BookingFetch = (
  input: string,
  init: RequestInit & { headers: Record<string, string> },
) => Promise<Response>

export async function createBookingReservation(
  request: BookingReservationRequest,
  fetcher: BookingFetch = fetch,
): Promise<BookingReservationResult> {
  if (!isReservableUuid(request.lessonId) || !isReservableUuid(request.lessonScheduleId)) {
    return failure(
      "UNRESERVABLE_DEMO_LESSON",
      "현재 표시된 데모 레슨은 실제 예약을 만들 수 없어요. 실제 예약 가능한 일정을 다시 선택해요.",
    )
  }

  let response: Response
  try {
    response = await fetcher("/api/reservations", {
      body: JSON.stringify(request),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  } catch {
    return failure("NETWORK_ERROR", "연결이 원활하지 않아요. 잠시 후 다시 시도해요.")
  }

  const body = await readJson(response)
  if (!response.ok) {
    return failure(readErrorCode(body), messageForErrorCode(readErrorCode(body)))
  }

  const reservation = readReservation(body)
  if (!reservation) {
    return failure("INVALID_RESPONSE", "예약 응답을 확인하지 못했어요. 다시 시도해요.")
  }

  return {
    paymentHref: `/reservations/${reservation.id}/payment`,
    reservation,
    status: "success",
  }
}

export function isReservableUuid(value: string) {
  return uuidPattern.test(value.trim())
}

function failure(code: string, message: string): BookingReservationResult {
  return { code, message, status: "failure" }
}

function messageForErrorCode(code: string) {
  if (code === "CAPACITY_EXCEEDED") {
    return "선택한 일정의 예약 가능 인원이 없어요. 다른 일정을 선택해요."
  }
  if (code === "CONFLICT") {
    return "예약 상태가 변경됐어요. 다시 확인해요."
  }
  if (code === "UNAUTHORIZED") {
    return "로그인이 필요해요. 다시 로그인해요."
  }
  if (code === "PROFILE_REQUIRED") {
    return "프로필 설정을 완료한 뒤 예약을 요청해요."
  }
  if (code === "SUPABASE_NOT_CONFIGURED") {
    return "예약 서버 설정이 아직 연결되지 않았어요. 잠시 후 다시 시도해요."
  }

  return "예약 요청을 완료하지 못했어요. 다시 확인해요."
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function readErrorCode(value: unknown) {
  if (!isRecord(value)) return "UNKNOWN_ERROR"
  const error = value["error"]
  if (!isRecord(error)) return "UNKNOWN_ERROR"
  const code = error["code"]

  return typeof code === "string" ? code : "UNKNOWN_ERROR"
}

function readReservation(value: unknown): BookingReservation | null {
  if (!isRecord(value)) return null
  const data = value["data"]
  if (!isRecord(data)) return null
  const id = data["id"]
  const paymentExpiresAt = data["paymentExpiresAt"]
  const reservedPriceAmount = data["reservedPriceAmount"]
  const status = data["status"]

  if (
    typeof id !== "string" ||
    typeof paymentExpiresAt !== "string" ||
    typeof reservedPriceAmount !== "number" ||
    status !== "pending_payment"
  ) {
    return null
  }

  return { id, paymentExpiresAt, reservedPriceAmount, status }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
