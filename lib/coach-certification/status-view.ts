import type { CoachStatus } from "../profile/types"

export type CoachStatusView = Readonly<{
  actionHref: string
  actionLabel: string
  description: string
  label: string
  tone: "error" | "neutral" | "success" | "warning"
}>

export function readCoachStatusView(status: CoachStatus): CoachStatusView {
  switch (status) {
    case "draft":
      return {
        actionHref: "/coach/apply",
        actionLabel: "신청서 계속 작성",
        description: "아직 심사에 제출되지 않았어요. 필수 정보와 자격 증빙을 확인해\u00a0주세요.",
        label: "작성 중",
        tone: "neutral",
      }
    case "submitted":
      return {
        actionHref: "/lessons",
        actionLabel: "레슨 둘러보기",
        description: "신청서가 안전하게 접수됐어요. 관리자 확인이 끝나면 상태가 바뀝니다.",
        label: "심사 중",
        tone: "warning",
      }
    case "approved":
      return {
        actionHref: "/mypage",
        actionLabel: "마이페이지로 이동",
        description:
          "지도자 인증이 완료됐어요. 승인된 계정 상태를 마이페이지에서 확인할\u00a0수\u00a0있어요.",
        label: "승인 완료",
        tone: "success",
      }
    case "rejected":
      return {
        actionHref: "/coach/apply",
        actionLabel: "신청서 보완",
        description: "반려 사유를 확인하고 신청 정보를 보완한 뒤 다시 제출해\u00a0주세요.",
        label: "보완 필요",
        tone: "error",
      }
    case "suspended":
      return {
        actionHref: "/auth/restricted?reason=account-suspended",
        actionLabel: "이용 제한 안내",
        description: "현재 계정 이용이 제한되어 지도자 활동을 진행할\u00a0수\u00a0없어요.",
        label: "이용 제한",
        tone: "error",
      }
    default:
      return assertNever(status)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected coach certification status: ${value}`)
}
