export const readyViewModel = {
  items: [
    {
      content: "작성한 내용이 없습니다.",
      createdAtText: "2026. 8. 31.",
      hiddenReason: null,
      key: "visible-review",
      lessonHref: "/lessons/active-lesson",
      lessonTitle: "긴 제목도 작은 화면에서 자연스럽게 줄바꿈되는 테니스 기초 레슨입니다",
      rating: 5,
      ratingLabel: "5점 만점에 5점",
      status: { label: "공개 중", tone: "success" },
    },
    {
      content: "운영 정책 검토를 위해 숨김 처리된 후기입니다.",
      createdAtText: "2026. 8. 30.",
      hiddenReason:
        "개인정보로 해석될 수 있는 긴 한국어 사유가 포함되어 운영 정책에 따라 숨김 처리되었습니다.",
      key: "hidden-review",
      lessonHref: null,
      lessonTitle: "현재 공개되지 않는 레슨",
      rating: 1,
      ratingLabel: "5점 만점에 1점",
      status: { label: "숨김", tone: "warning" },
    },
  ],
  page: 2,
  totalCount: 21,
  totalPages: 2,
}
