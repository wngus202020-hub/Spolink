import type { PaymentPageState } from "@/lib/payments/payment-page-data"

export type PaymentStatePresentation = Readonly<{
  badge: string
  description: string
  icon: "alert" | "clock" | "confirmed" | "credit-card" | "shield"
  title: string
  tone: "neutral" | "success" | "warning"
}>

const paymentStatePresentations = {
  confirmed: {
    badge: "결제 처리 상태",
    description: "이미 처리된 예약이에요. 이 화면에서는 추가 결제 요청을 준비할 수 없어요.",
    icon: "confirmed",
    title: "결제 처리가 끝난 예약이에요",
    tone: "success",
  },
  expired_pending: {
    badge: "준비 시간 만료",
    description:
      "결제 준비 가능 시간이 지나 이 예약에서는 결제 요청 정보를 만들 수 없어요. 레슨 일정을 다시 확인해요.",
    icon: "clock",
    title: "결제 준비 시간이 지났어요",
    tone: "warning",
  },
  not_found: {
    badge: "예약 정보 없음",
    description:
      "요청한 예약을 찾지 못했어요. 주소가 정확한지 확인하고 내 예약 경로에서 다시 접근해요.",
    icon: "alert",
    title: "예약 정보를 찾을 수 없어요",
    tone: "neutral",
  },
  pending_valid: {
    badge: "결제 준비 전",
    description:
      "아래 예약 정보를 확인한 뒤 결제 요청 준비 버튼을 누르면 돼요. 이 단계에서는 비용 청구나 예약 상태 변경이 일어나지 않아요.",
    icon: "credit-card",
    title: "결제 요청 정보를 준비해요",
    tone: "warning",
  },
  read_failure: {
    badge: "정보 확인 실패",
    description:
      "예약 정보를 불러오지 못했어요. 연결 상태를 확인한 뒤 잠시 후 페이지를 다시 열어 봐요.",
    icon: "alert",
    title: "결제 정보를 확인하지 못했어요",
    tone: "warning",
  },
  ready: {
    badge: "요청 준비됨",
    description:
      "결제 요청 정보가 준비돼 있어요. 아직 결제 승인이나 예약 상태 변경은 이루어지지 않았어요.",
    icon: "shield",
    title: "준비된 결제 요청을 확인해요",
    tone: "warning",
  },
  terminal: {
    badge: "종료된 예약",
    description:
      "취소 또는 종료된 예약에서는 결제 요청 정보를 준비할 수 없어요. 현재 예약 상태를 다시 확인해요.",
    icon: "alert",
    title: "결제를 준비할 수 없는 예약이에요",
    tone: "neutral",
  },
  unavailable: {
    badge: "결제 준비 불가",
    description:
      "현재 예약 또는 결제 상태에서는 요청 정보를 준비할 수 없어요. 잠시 후 예약 상태를 다시 확인해요.",
    icon: "alert",
    title: "지금은 결제를 준비할 수 없어요",
    tone: "neutral",
  },
} satisfies Record<PaymentPageState, PaymentStatePresentation>

export function getPaymentStatePresentation(state: PaymentPageState): PaymentStatePresentation {
  return paymentStatePresentations[state]
}
