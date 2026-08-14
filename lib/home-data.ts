import { futureDemoStartsAt } from "@/lib/demo-schedule-dates"
import type { Lesson, TrustMetric } from "@/lib/home-data-types"

export type {
  Lesson,
  LessonMedia,
  LessonReview,
  LessonSchedule,
  LessonStatus,
  TrustMetric,
} from "@/lib/home-data-types"

export const trustMetrics = [
  { label: "지도자 인증", value: "필수 심사" },
  { label: "예약 흐름", value: "결제 후 확정" },
  { label: "환불 기준", value: "시간별 고지" },
] satisfies readonly TrustMetric[]

export const featuredLessons = [
  {
    id: "tennis-gangnam",
    title: "퇴근 후 50분 테니스 입문",
    sportId: "00000000-0000-4000-8000-000000000101",
    sport: "테니스",
    region: "서울 강남구",
    coachId: "00000000-0000-4000-8000-000000000201",
    coachName: "김서준 코치",
    summary: "라켓을 처음 잡는 학습자도 코트 기본기와 랠리 감각을 차근차근 익히는 입문 레슨이에요.",
    priceAmount: 45_000,
    priceText: "45,000원",
    durationMinutes: 50,
    scheduleText: "내일 19:30",
    durationText: "50분",
    venueText: "강남 실내 테니스 코트",
    preparationText: "운동화, 개인 물, 편한 운동복",
    refundSummary: "24시간 이상 70%, 3시간 이상 24시간 미만 50%, 3시간 미만 0% 환불",
    coachProfileText: "초보자 코칭에 강한 인증 코치예요.",
    coachExperienceText: "입문 그룹 레슨 4년, 누적 수업 680회",
    ratingAverage: null,
    ratingText: "인증 지도자 후기",
    capacityText: "2자리 남음",
    reviewSummary: "초보자 자세 교정 후기가 많아요.",
    reviews: [
      {
        content: "초보자 자세 교정 후기가 많아요.",
        createdAt: "2026-07-10T09:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000301",
        rating: 5,
      },
    ],
    detailBullets: ["그립과 준비 자세", "포핸드 기본 스윙", "짧은 랠리와 마무리 피드백"],
    schedules: [
      {
        id: "tennis-gangnam-today",
        label: "내일 19:30",
        capacityText: "2자리 남음",
        capacity: 4,
        isOpen: true,
        remainingCount: 2,
        reservedCount: 2,
        startsAt: futureDemoStartsAt(1, { hour: 10, minute: 30 }),
      },
      {
        id: "tennis-gangnam-thu",
        label: "목요일 20:00",
        capacityText: "3자리 남음",
        capacity: 4,
        isOpen: true,
        remainingCount: 3,
        reservedCount: 1,
        startsAt: futureDemoStartsAt(3, { hour: 11 }),
      },
      {
        id: "tennis-gangnam-sat",
        label: "토요일 09:00",
        capacityText: "1자리 남음",
        capacity: 4,
        isOpen: true,
        remainingCount: 1,
        reservedCount: 3,
        startsAt: futureDemoStartsAt(5, { hour: 0 }),
      },
      {
        id: "tennis-gangnam-closed",
        label: "마감 일정",
        capacityText: "마감",
        capacity: 4,
        isOpen: false,
        remainingCount: 0,
        reservedCount: 4,
        startsAt: futureDemoStartsAt(7, { hour: 9 }),
      },
    ],
    status: "active",
    media: { kind: "photo", src: "/images/lesson-tennis.webp" },
  },
  {
    id: "pilates-songpa",
    title: "체형 교정 필라테스 소그룹",
    sportId: "00000000-0000-4000-8000-000000000102",
    sport: "필라테스",
    region: "서울 송파구",
    coachId: "00000000-0000-4000-8000-000000000202",
    coachName: "이하린 코치",
    summary: "소그룹으로 호흡, 코어 안정, 자세 정렬을 점검해요.",
    priceAmount: 38_000,
    priceText: "38,000원",
    durationMinutes: 55,
    scheduleText: "내일 10:00",
    durationText: "55분",
    venueText: "송파 리포머 필라테스 스튜디오",
    preparationText: "미끄럼 방지 양말, 편한 운동복",
    refundSummary: "24시간 이상 70%, 3시간 이상 24시간 미만 50%, 3시간 미만 0% 환불",
    coachProfileText: "체형 평가와 소그룹 코칭에 강한 코치예요.",
    coachExperienceText: "재활 필라테스 지도 5년, 반복 예약 후기 다수",
    ratingAverage: null,
    ratingText: "반복 예약 후기",
    capacityText: "마감 임박",
    reviewSummary: "동작 설명이 자세하다는 후기가 많아요.",
    reviews: [
      {
        content: "동작 설명이 자세하다는 후기가 많아요.",
        createdAt: "2026-07-09T09:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000302",
        rating: 5,
      },
    ],
    detailBullets: ["호흡과 코어 활성", "골반과 어깨 정렬", "개인별 동작 난도 조정"],
    schedules: [
      {
        id: "pilates-songpa-tomorrow",
        label: "내일 10:00",
        capacityText: "마감 임박",
        capacity: 6,
        isOpen: true,
        remainingCount: 1,
        reservedCount: 5,
        startsAt: futureDemoStartsAt(1, { hour: 1 }),
      },
      {
        id: "pilates-songpa-fri",
        label: "금요일 11:00",
        capacityText: "2자리 남음",
        capacity: 6,
        isOpen: true,
        remainingCount: 2,
        reservedCount: 4,
        startsAt: futureDemoStartsAt(4, { hour: 2 }),
      },
      {
        id: "pilates-songpa-sun",
        label: "일요일 15:00",
        capacityText: "4자리 남음",
        capacity: 6,
        isOpen: true,
        remainingCount: 4,
        reservedCount: 2,
        startsAt: futureDemoStartsAt(6, { hour: 6 }),
      },
    ],
    status: "active",
    media: { kind: "photo", src: "/images/lesson-pilates.webp" },
  },
  {
    id: "running-mapo",
    title: "한강 러닝 자세 교정",
    sportId: "00000000-0000-4000-8000-000000000103",
    sport: "러닝",
    region: "서울 마포구",
    coachId: "00000000-0000-4000-8000-000000000203",
    coachName: "박도윤 코치",
    summary: "한강 러닝 코스에서 착지, 보폭, 호흡을 점검하는 야외 러닝 자세 교정 수업이에요.",
    priceAmount: 25_000,
    priceText: "25,000원",
    durationMinutes: 60,
    scheduleText: "토요일 08:00",
    durationText: "60분",
    venueText: "망원 한강공원 러닝 코스",
    preparationText: "러닝화, 개인 물, 날씨에 맞는 복장",
    refundSummary: "야외 수업은 악천후 시 일정 변경 우선",
    coachProfileText: "러닝 자세 분석과 초보 페이스 조절을 준비 중인 지도자예요.",
    coachExperienceText: "동호회 페이스 메이커 3년",
    ratingAverage: null,
    ratingText: "신규 레슨",
    capacityText: "5자리 남음",
    reviewSummary: "관리자 검토 후 공개 리뷰를 수집할 예정이에요.",
    reviews: [],
    detailBullets: ["기본 보행과 착지 점검", "보폭과 케이던스 조정", "개인별 페이스 피드백"],
    schedules: [
      {
        id: "running-mapo-sat",
        label: "토요일 08:00",
        capacityText: "5자리 남음",
        capacity: 8,
        isOpen: true,
        remainingCount: 5,
        reservedCount: 3,
        startsAt: futureDemoStartsAt(5, { hour: 23 }),
      },
    ],
    status: "pending_review",
    media: { kind: "photo", src: "/images/lesson-running.webp" },
  },
] satisfies readonly Lesson[]

export function getLessonById(lessonId: string) {
  return featuredLessons.find((lesson) => lesson.id === lessonId)
}

export function getActiveLessons(): readonly Lesson[] {
  return featuredLessons.filter((lesson) => lesson.status === "active")
}

export function getActiveLessonById(lessonId: string) {
  const lesson = getLessonById(lessonId)

  return lesson?.status === "active" ? lesson : undefined
}
