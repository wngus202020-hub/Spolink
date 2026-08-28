import type { PageAuthProfile } from "@/lib/auth/page-auth"

export type CoachNavigationEntry = Readonly<
  | {
      actionLabel: "센터 열기"
      ariaLabel: "지도자 센터로 이동"
      cardLabel: "지도자 센터"
      description: "오늘 일정, 예약과 정산 운영을 관리해요."
      headerLabel: "지도자 센터"
      href: "/coach/dashboard"
      kind: "center"
    }
  | {
      actionLabel: "등록 안내"
      ariaLabel: "지도자 등록 안내로 이동"
      cardLabel: "지도자 등록"
      description: "자격과 경력을 인증하고 지도자 활동을 준비해요."
      headerLabel: "지도자 등록"
      href: "/coach/apply"
      kind: "application"
    }
  | {
      actionLabel: "상태 확인"
      ariaLabel: "지도자 등록 상태로 이동"
      cardLabel: "지도자 등록 상태"
      description: "신청 및 심사 상태를 확인하고 필요한 다음 단계를 진행해요."
      headerLabel: "등록 상태"
      href: "/coach/apply/status"
      kind: "status"
    }
>

const applicationEntry: CoachNavigationEntry = {
  actionLabel: "등록 안내",
  ariaLabel: "지도자 등록 안내로 이동",
  cardLabel: "지도자 등록",
  description: "자격과 경력을 인증하고 지도자 활동을 준비해요.",
  headerLabel: "지도자 등록",
  href: "/coach/apply",
  kind: "application",
}

const centerEntry: CoachNavigationEntry = {
  actionLabel: "센터 열기",
  ariaLabel: "지도자 센터로 이동",
  cardLabel: "지도자 센터",
  description: "오늘 일정, 예약과 정산 운영을 관리해요.",
  headerLabel: "지도자 센터",
  href: "/coach/dashboard",
  kind: "center",
}

const statusEntry: CoachNavigationEntry = {
  actionLabel: "상태 확인",
  ariaLabel: "지도자 등록 상태로 이동",
  cardLabel: "지도자 등록 상태",
  description: "신청 및 심사 상태를 확인하고 필요한 다음 단계를 진행해요.",
  headerLabel: "등록 상태",
  href: "/coach/apply/status",
  kind: "status",
}

export function getCoachNavigationEntry(auth: PageAuthProfile): CoachNavigationEntry {
  if (auth.kind !== "ready") return applicationEntry

  const coachStatus = auth.coachProfile?.status
  if (auth.profile.status === "coach_approved" && coachStatus === "approved") {
    return centerEntry
  }
  if (auth.profile.status === "coach_approved" || (coachStatus && coachStatus !== "draft")) {
    return statusEntry
  }
  return applicationEntry
}
