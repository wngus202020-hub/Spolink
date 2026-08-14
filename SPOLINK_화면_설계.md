# SPOLINK 화면 설계 v0.1

## 문서 목적

SPOLINK MVP의 화면 구조, 사용자 흐름, 화면별 기능, 상태, 빈 화면, 오류 화면을 정의한다. 이 문서는 `SPOLINK_서비스_정책서.md`, `SPOLINK_ERD.md`, `SPOLINK_API_명세서.md`를 UI 흐름으로 옮기는 기준 문서다.

## 설계 기준

- MVP는 레슨 거래 흐름을 중심으로 한다.
- 화면은 Next.js App Router 기준으로 설계한다.
- 현재 구현된 화면과 이후 MVP 후보를 구분한다. 구현된 화면의 시각·접근성 기준은 `SPOLINK_디자인_시스템.md`를 따른다.
- 운동 메이트, 운동 기록, GPS/QR 출석, 배지, 목표 관리는 Phase 2 화면으로 미룬다.
- 지도자 인증, 예약, 결제, 환불, 정산, 리뷰, 신고 흐름은 정책서와 API 명세를 따른다.

## 현재 구현 정합성 (2026-08-02)

### 구현된 경로와 표면

- 공개 탐색: `/`, `/lessons`, `/lessons/[lessonId]`, `/lessons/[lessonId]/booking`, `/reservations/[reservationId]/payment`.
- 계정·온보딩: `/auth/login`, `/auth/signup`, `/auth/check-email`, `/auth/reset-password`, `/auth/update-password`, `/onboarding/profile`.
- 로그인 사용자: `/coach/apply`, `/mypage`, `/mypage/reservations`, `/mypage/reservations/[reservationId]`, `/mypage/favorites`.
- 이 경로들은 현재 동작하는 화면이다. `/coach/apply`는 인증 신청 임시 저장, private `coach-certificates` 자격증 파일 업로드·등록·삭제, 심사 제출을 제공한다. 공개 찜 추가·삭제 mutation은 아직 구현하지 않았으며, 해당 UI를 완료된 기능으로 안내하지 않는다.

### 탐색, 검색, 미디어

- 지역 선택지는 고정된 공식 complete `전국 법정동_20260630` 스냅샷을 사용한다. 런타임 공공데이터 호출, 지도 연동, 거리순은 범위 밖이다.
- 날짜 `YYYY-MM-DD`는 `Asia/Seoul`의 `[00:00, 다음 날 00:00)`로 해석한다. 그 날짜에 시작하는 open·non-full 일정으로 레슨 ID를 먼저 제한한 다음 public lesson limit을 적용한다.
- Supabase 읽기가 미구성일 때만 동일 matcher로 local demo fallback을 사용한다. 구성된 읽기의 성공 빈 결과는 빈 결과 그대로 보이고 demo 카드로 대체하지 않으며, 읽기 실패는 별도 오류 상태다.
- 모바일 검색은 compact trigger가 native `<dialog>` bottom sheet를 열고, 데스크톱 검색은 지역·종목·일정의 3개 segmented pill과 원형 검색 버튼을 사용한다. URL 쿼리, 새로고침, 뒤로 가기 후 선택값을 복원한다.
- 홈은 예약을 결정하기 전의 발견·신뢰 동선이다. 선택되지 않은 예약 가격, 예약 CTA, `MVP`·`Supabase` 같은 내부 구현 용어를 홈 발견 패널에 노출하지 않는다.
- 레슨 카드는 `photo | missing` 미디어 상태를 사용한다. 사진 로드 실패는 한 번만 neutral missing 표시로 전환하며 SVG를 사진 대체물로 쓰지 않는다.

### 인증 실패 복구와 보류 항목

- 비밀번호 재설정은 network, abort, non-2xx 실패 뒤 이메일 입력값을 유지하고 submit을 복구해 재시도할 수 있게 하며 generic alert에 focus한다. 회원가입 provider-error는 React 오류 상태 반영 뒤 첫 invalid field에 focus한다.
- 현재 확인된 서버 상태는 local-only Supabase/Auth/RLS/cancellation과 지도자 인증 신청·private `coach-certificates` Storage·관리자 심사 구현 및 그 E2E다. hosted Supabase, actual Toss refund, maps, chat, push, public favorite mutation은 deferred다.

## UX 원칙

- 신뢰: 지도자 인증 상태, 환불 기준, 결제 금액, 예약 상태를 숨기지 않는다.
- 가까움: 지역, 거리, 일정, 지도 기반 탐색이 빠르게 보인다.
- 단순함: 예약과 결제는 한 화면에서 한 결정만 요구한다.
- 안전: 신고, 차단, 취소, 환불 진입점을 찾기 쉽게 둔다.
- 지속성: 리뷰, 마이페이지, 다음 예약 동선을 자연스럽게 연결한다.

## 사용자 흐름 요약

### 학습자 MVP 흐름

```text
홈
-> 레슨 검색
-> 레슨 상세
-> 일정 선택
-> 예약 확인
-> 결제
-> 예약 완료
-> 마이페이지 예약 상세
-> 수업 완료
-> 리뷰 작성
```

### 지도자 MVP 흐름

```text
회원가입/로그인
-> 지도자 인증 신청
-> 관리자 승인 대기
-> 레슨 등록
-> 일정 등록
-> 예약 관리
-> 수업 완료 처리
-> 정산 확인
```

### 관리자 MVP 흐름

```text
관리자 로그인
-> 지도자 인증 심사
-> 신고 검토
-> 예약/결제/환불 상태 확인
-> 정산 보류/승인
```

## 정보 구조

```text
/
/auth/login
/auth/signup
/onboarding/profile
/coach/apply
/coach/apply/status
/lessons
/lessons/[lessonId]
/lessons/[lessonId]/booking
/reservations/[reservationId]/payment
/reservations/[reservationId]/complete
/mypage
/mypage/reservations
/mypage/reservations/[reservationId]
/mypage/reviews/new?reservationId=
/coach/dashboard
/coach/lessons
/coach/lessons/new
/coach/lessons/[lessonId]/edit
/coach/reservations
/coach/settlements
/admin
/admin/coaches
/admin/reports
/admin/reservations
```

## 공통 레이아웃

### 공개 영역

사용 화면:

- 홈
- 레슨 검색
- 레슨 상세
- 로그인
- 회원가입

공통 구성:

- 상단 내비게이션
- 브랜드 로고
- 지역/검색 진입
- 로그인 또는 마이페이지 링크
- 지도자 등록 CTA
- 하단 푸터

주의:

- 앱 기능 설명을 과하게 늘어놓는 랜딩 페이지보다 바로 검색과 예약으로 진입하게 한다.
- 브랜드 문구는 `가장 가까운 스포츠 플랫폼.`을 기준으로 한다.

### 로그인 사용자 영역

사용 화면:

- 마이페이지
- 예약 상세
- 리뷰 작성
- 지도자 인증 신청

공통 구성:

- 상단 내비게이션
- 현재 사용자 상태
- 예약/찜/리뷰/신고 진입
- 계정 상태 안내

### 지도자 영역

사용 화면:

- 지도자 대시보드
- 레슨 관리
- 일정 관리
- 예약 관리
- 정산 조회

공통 구성:

- 좌측 또는 상단 관리 내비게이션
- 인증 상태 배너
- 오늘 수업
- 처리 필요 예약
- 정산 요약

### 관리자 영역

사용 화면:

- 관리자 홈
- 지도자 인증 심사
- 신고 검토
- 예약/결제/환불 상태 확인
- 정산 승인/보류

공통 구성:

- 관리자 권한 확인
- 작업 큐
- 상세 패널
- 감사 로그 메모

## 화면 상세

## 1. 홈

후보 경로:

```text
/
```

목적:

- 사용자가 가까운 레슨을 바로 찾게 한다.
- SPOLINK의 핵심 가치인 배우기, 함께하기, 활동하기를 짧게 전달한다.

주요 사용자:

- 게스트
- 학습자
- 지도자 후보

주요 콘텐츠:

- 지역 기반 검색 입력
- 종목 선택
- 인기 종목
- 가까운 레슨 미리보기
- 지도자 등록 진입
- 브랜드 카피: 배우고, 함께하고, 활동하는 모든 순간을 연결합니다.

주요 액션:

- 레슨 검색
- 내 주변 레슨 보기
- 로그인
- 지도자 등록

연결 API:

- `GET /api/sports`
- `GET /api/lessons`

상태:

- 비로그인
- 로그인
- 위치 동의 전
- 위치 동의 후

빈 화면:

- 선택 지역에 레슨이 없으면 다른 지역/종목 검색을 제안한다.

오류:

- 위치 권한 거부
- 레슨 목록 조회 실패

## 2. 로그인

후보 경로:

```text
/auth/login
```

목적:

- Supabase Auth 기반 로그인 진입.

주요 콘텐츠:

- 이메일 로그인
- 회원가입 링크
- 비밀번호 재설정 링크
- 제한 계정 안내

주요 액션:

- 로그인
- 회원가입으로 이동
- 비밀번호 재설정

연결 기능:

- Supabase Auth
- `GET /api/me`

오류:

- 계정 없음
- 비밀번호 오류
- 정지 계정
- 탈퇴 계정

제외/연기:

- 소셜 로그인은 MVP 인증 화면에 노출하지 않고 후속 단계에서 검토한다.

## 3. 회원가입

후보 경로:

```text
/auth/signup
```

목적:

- 이메일/비밀번호로 기본 인증 계정만 생성한다.

주요 콘텐츠:

- 이메일
- 비밀번호
- 이메일 확인 안내

주요 액션:

- 계정 생성

연결 API:

- Supabase Auth signup

다음 화면:

- `/onboarding/profile`
- 이메일 확인 필요 시 `/auth/check-email`

정책:

- 회원가입 단계에서는 이름, 연락처, 지역, 동의 정보 등 프로필 개인 정보를 수집하거나 Auth metadata, 로컬 스토리지, URL에 저장하지 않는다.
- 소셜 로그인과 관심 종목 저장은 MVP 범위에서 연기한다.

## 4. 온보딩 프로필

후보 경로:

```text
/onboarding/profile
```

목적:

- 인증된 신규 사용자의 필수 프로필을 생성한다.

주요 콘텐츠:

- 표시 이름
- 실명
- 연락처
- 기본 활동 지역
- 위치정보 동의
- 마케팅 동의
- 학습자/지도자 목적 선택

주요 액션:

- 레슨 찾기 시작
- 지도자 인증 신청으로 이동

연결 API:

- `POST /api/profiles`
- `GET /api/me`

정책:

- `/onboarding/profile`은 프로필 필드의 소유 화면이며, 프로필이 없는 인증 사용자는 예약/결제 진입 전에 반드시 이 화면을 완료한다.
- 이 화면은 프로필이 없는 신규 사용자의 생성 전용 화면이다. 기존 프로필 수정은 별도 마이페이지 프로필 수정 화면에서 `PATCH /api/profiles/me`로 처리한다.
- 학습자/지도자 목적 선택은 다음 이동 경로를 정하는 UI 상태일 뿐이며 `role`, `status`, 지도자 승인 상태 같은 권한 값으로 저장하지 않는다.
- 관심 종목 영구 저장은 MVP 범위에서 연기하며 이 화면의 필수 저장 계약에 포함하지 않는다.

## 5. 지도자 인증 신청

구현 경로:

```text
/coach/apply
```

목적:

- 지도자가 활동하기 위한 인증 정보를 제출한다.

주요 콘텐츠:

- 실명
- 연락처
- 프로필 사진
- 활동 지역
- 전문 종목
- 경력
- 자격증 업로드
- 정산 계좌 요약 정보

주요 액션:

- 임시 저장
- 자격증 업로드
- 심사 제출

연결 API:

- `GET /api/coach-profile/me`
- `PUT /api/coach-profile/me`
- `POST /api/coach-profile/me/certificate-upload-url`
- `POST /api/coach-profile/me/certificates`
- `DELETE /api/coach-profile/me/certificates/{certificateId}`
- `POST /api/coach-profile/me/submit`

상태:

- `draft`
- `submitted`
- `approved`
- `rejected`
- `suspended`

오류:

- 필수 정보 누락
- 자격증 파일 누락
- 업로드 실패
- 반려 사유 표시
- PNG/JPEG/PDF 외 형식, 10MB 초과, MIME/파일 시그니처 불일치
- 만료된 300초 signed URL, 중복 업로드, 제출 상태 충돌

표시/보안 규칙:

- 자격증 목록에는 자격증명, 발급기관, 자격번호, 검증 시각만 표시하고 object name, signed
  URL, 원본 bytes는 표시하지 않는다.
- draft/rejected만 편집·업로드·삭제할 수 있고 submitted/approved/suspended는 읽기 전용이다.
- 401/403/409/415/422 오류는 현재 입력과 키보드 초점을 유지하며 한국어 다음 행동을 제공한다.
- 데스크톱 1280×800, Pixel 5 390×844, 태블릿 768×1024에서 가로 잘림 없이 동작한다.

## 6. 지도자 인증 상태

구현 경로:

```text
/coach/apply/status
```

목적:

- 심사 상태를 명확히 안내한다.

주요 콘텐츠:

- 현재 인증 상태
- 제출 일시
- 반려 사유
- 다음 액션

주요 액션:

- 수정 후 재제출
- 신청서 계속 작성 또는 보완
- 레슨 둘러보기, 승인 후 마이페이지 이동, 이용 제한 안내

연결 API:

- `GET /api/coach-profile/me`

## 7. 레슨 검색

후보 경로:

```text
/lessons
```

목적:

- 학습자가 지역, 종목, 가격, 일정 기준으로 레슨을 찾는다.

주요 콘텐츠:

- 검색어
- 지역
- 종목
- 가격 범위
- 날짜 필터
- 레슨 리스트
- 지도 영역 또는 지도 보기 진입

주요 액션:

- 필터 적용
- 레슨 상세 이동
- 찜

연결 API:

- `GET /api/sports`
- `GET /api/lessons`

상태:

- 검색 전 추천
- 검색 결과 있음
- 검색 결과 없음
- 로딩
- 오류

빈 화면:

- 조건을 줄이거나 다른 지역을 선택하게 한다.

## 8. 레슨 상세

후보 경로:

```text
/lessons/[lessonId]
```

목적:

- 사용자가 지도자, 수업, 가격, 장소, 리뷰, 환불 기준을 확인하고 예약을 결정한다.

주요 콘텐츠:

- 레슨 이미지
- 제목
- 종목
- 지도자 프로필 요약
- 인증 표시
- 가격
- 수업 시간
- 장소
- 준비물
- 취소/환불 요약
- 예약 가능 일정
- 리뷰
- 신고 진입

주요 액션:

- 일정 선택
- 예약하기
- 찜
- 공유
- 신고

연결 API:

- `GET /api/lessons/{lessonId}`
- `GET /api/lessons/{lessonId}/schedules`
- `GET /api/lessons/{lessonId}/reviews`

상태:

- 공개 레슨
- 비공개 또는 종료 레슨
- 일정 없음
- 리뷰 없음

주의:

- 예약 전 가격, 일정, 취소/환불 기준을 반드시 보이게 한다.

## 9. 예약 확인

후보 경로:

```text
/lessons/[lessonId]/booking
```

목적:

- 결제 전 예약 정보를 최종 확인한다.

주요 콘텐츠:

- 선택 레슨
- 선택 일정
- 지도자
- 장소
- 결제 금액
- 환불 기준
- 예약자 정보

주요 액션:

- 예약 생성
- 일정 변경
- 결제로 이동

연결 API:

- `POST /api/reservations`

상태:

- 예약 가능
- 정원 초과
- 일정 마감
- 로그인 필요

오류:

- `CAPACITY_EXCEEDED`
- `CONFLICT`
- `UNAUTHORIZED`

## 10. 결제

후보 경로:

```text
/reservations/[reservationId]/payment
```

목적:

- Toss Payments 결제를 시작하고 검증까지 연결한다.

주요 콘텐츠:

- 결제 금액
- 레슨명
- 예약 만료 시간
- 결제 수단 영역
- 환불 기준

주요 액션:

- 결제 요청 생성
- 결제 승인
- 결제 실패 시 재시도

연결 API:

- `POST /api/payments/prepare`
- `POST /api/payments/confirm`

상태:

- `pending_payment`
- 결제 준비
- 결제 진행
- 결제 성공
- 결제 실패
- 예약 만료

오류:

- `RESERVATION_EXPIRED`
- `PAYMENT_VERIFICATION_FAILED`
- `EXTERNAL_PROVIDER_ERROR`

주의:

- 결제 완료 화면은 클라이언트 응답만 믿지 않고 서버 검증 완료 후 표시한다.

## 11. 예약 완료

후보 경로:

```text
/reservations/[reservationId]/complete
```

목적:

- 결제 검증 후 예약 확정 상태를 보여준다.

주요 콘텐츠:

- 예약 확정 상태
- 레슨명
- 일정
- 장소
- 지도자 연락 또는 안내
- 취소/환불 진입
- 마이페이지 이동

주요 액션:

- 예약 상세 보기
- 캘린더 등록
- 레슨 더 보기

연결 API:

- `GET /api/reservations/{reservationId}`

## 12. 마이페이지 홈

후보 경로:

```text
/mypage
```

목적:

- 학습자의 예약, 찜, 리뷰, 프로필을 한곳에서 관리한다.

주요 콘텐츠:

- 사용자 프로필
- 다음 예약
- 최근 예약
- 찜한 레슨
- 리뷰 작성 대기
- 신고/문의 진입

주요 액션:

- 예약 상세
- 프로필 수정
- 리뷰 작성
- 지도자 등록

연결 API:

- `GET /api/me`
- `GET /api/reservations`
- `GET /api/notifications`

## 13. 내 예약 목록

후보 경로:

```text
/mypage/reservations
```

목적:

- 학습자가 예약 상태별로 수업을 확인한다.

주요 콘텐츠:

- 예정 예약
- 완료 예약
- 취소 예약
- 결제 대기 예약
- 분쟁 예약

필터:

- 전체
- 결제 대기
- 예약 확정
- 완료
- 취소
- 노쇼
- 분쟁

연결 API:

- `GET /api/reservations?role=learner`

## 14. 예약 상세

후보 경로:

```text
/mypage/reservations/[reservationId]
```

목적:

- 예약 상태, 결제, 환불, 리뷰, 신고를 관리한다.

주요 콘텐츠:

- 예약 상태
- 레슨 정보
- 일정
- 지도자
- 결제 정보
- 환불 가능 여부
- 리뷰 상태
- 신고/차단 진입

주요 액션:

- 예약 취소
- 결제 계속하기
- 리뷰 작성
- 신고하기

연결 API:

- `GET /api/reservations/{reservationId}`
- `POST /api/reservations/{reservationId}/cancel`
- `POST /api/refunds`
- `POST /api/reports`
- `POST /api/blocks`

상태별 CTA:

| 예약 상태 | 기본 CTA |
|-----------|----------|
| pending_payment | 결제 계속하기, 예약 취소 |
| confirmed | 예약 취소, 신고 |
| completed | 리뷰 작성, 다시 예약 |
| cancelled_by_user | 환불 상태 보기 |
| cancelled_by_coach | 환불 상태 보기 |
| no_show_user | 신고 |
| no_show_coach | 환불 상태 보기, 신고 |
| disputed | 처리 상태 보기 |

## 15. 리뷰 작성

후보 경로:

```text
/mypage/reviews/new?reservationId=
```

목적:

- 완료된 예약에 대해 리뷰를 남긴다.

주요 콘텐츠:

- 레슨 요약
- 지도자 요약
- 별점
- 리뷰 내용
- 작성 기준 안내

주요 액션:

- 리뷰 등록
- 취소

연결 API:

- `POST /api/reviews`

검증:

- `completed` 예약만 작성 가능
- 예약당 1개만 작성 가능

## 16. 지도자 대시보드

후보 경로:

```text
/coach/dashboard
```

목적:

- 지도자가 오늘 수업, 예약, 정산, 처리 필요 항목을 확인한다.

주요 콘텐츠:

- 인증 상태
- 오늘 수업
- 예약 요청/확정 현황
- 완료 처리 대기
- 정산 대기 금액
- 최근 리뷰

주요 액션:

- 레슨 등록
- 일정 등록
- 예약 관리
- 정산 보기

연결 API:

- `GET /api/me`
- `GET /api/reservations?role=coach`
- `GET /api/settlements`
- `GET /api/notifications`

상태:

- 인증 미제출
- 심사 중
- 승인됨
- 반려됨
- 활동 제한

## 17. 지도자 레슨 목록

후보 경로:

```text
/coach/lessons
```

목적:

- 지도자가 본인 레슨을 관리한다.

주요 콘텐츠:

- 레슨 목록
- 상태
- 가격
- 예약 가능 일정 수
- 최근 예약 수

주요 액션:

- 새 레슨 등록
- 수정
- 일시 중지
- 종료
- 일정 관리

연결 API:

- `GET /api/lessons` with coach scope
- `POST /api/lessons/{lessonId}/status`

## 18. 레슨 등록/수정

후보 경로:

```text
/coach/lessons/new
/coach/lessons/[lessonId]/edit
```

목적:

- 지도자가 레슨 상품 정보를 등록하거나 수정한다.

주요 콘텐츠:

- 종목
- 제목
- 요약
- 상세 설명
- 지역
- 장소
- 가격
- 수업 시간
- 정원
- 준비물
- 취소 정책 요약
- 이미지

주요 액션:

- 임시 저장
- 검토 요청
- 수정 저장

연결 API:

- `GET /api/sports`
- `POST /api/lessons`
- `PATCH /api/lessons/{lessonId}`
- `POST /api/storage/signed-upload-url`

## 19. 일정 관리

후보 경로:

```text
/coach/lessons/[lessonId]/schedules
```

목적:

- 지도자가 예약 가능한 시간을 등록한다.

주요 콘텐츠:

- 달력
- 일정 목록
- 정원
- 예약 수
- 열림/닫힘 상태

주요 액션:

- 일정 추가
- 일정 닫기
- 일정 수정

연결 API:

- `GET /api/lessons/{lessonId}/schedules`
- `POST /api/lessons/{lessonId}/schedules`

주의:

- 이미 확정 예약이 있는 일정은 삭제 대신 닫기 또는 관리자 처리로 제한한다.

## 20. 지도자 예약 관리

후보 경로:

```text
/coach/reservations
```

목적:

- 지도자가 수업 예약을 확인하고 완료/노쇼/취소를 처리한다.

주요 콘텐츠:

- 예약 목록
- 학습자 이름
- 레슨
- 일정
- 결제/예약 상태
- 처리 필요 상태

주요 액션:

- 예약 상세
- 수업 완료 처리
- 지도자 취소
- 노쇼 처리

연결 API:

- `GET /api/reservations?role=coach`
- `POST /api/reservations/{reservationId}/complete`
- `POST /api/reservations/{reservationId}/cancel`
- `POST /api/reservations/{reservationId}/no-show`

## 21. 지도자 정산

후보 경로:

```text
/coach/settlements
```

목적:

- 지도자가 정산 상태와 지급 예정 금액을 확인한다.

주요 콘텐츠:

- 정산 대기
- 보류
- 승인
- 지급 완료
- 지급 실패
- 예약별 정산 상세

연결 API:

- `GET /api/settlements`

주의:

- 계좌 전체 번호는 표시하지 않는다.
- 보류 사유는 명확히 표시한다.

## 22. 관리자 홈

후보 경로:

```text
/admin
```

목적:

- 관리자가 처리 대기 업무를 한 화면에서 본다.

주요 콘텐츠:

- 지도자 인증 대기 수
- 신고 대기 수
- 분쟁 예약 수
- 정산 보류 수

연결 API:

- 관리자 API 묶음

권한:

- `profiles.role = admin`

## 23. 관리자 지도자 인증

구현 경로:

```text
/admin/coaches
```

목적:

- 제출된 지도자 인증을 승인 또는 반려한다.

주요 콘텐츠:

- 신청자 정보
- 프로필
- 자격증 메타데이터와 300초 private signed read
- 경력
- 활동 지역
- 심사 기록

주요 액션:

- 승인
- 반려
- 활동 제한

연결 API:

- `GET /api/admin/coach-profiles`
- `GET /api/admin/coach-profiles/{coachProfileId}`
- `GET /api/admin/coach-profiles/{coachProfileId}/certificates/{certificateId}`
- `POST /api/admin/coach-profiles/{coachProfileId}/approve`
- `POST /api/admin/coach-profiles/{coachProfileId}/reject`

상태/오류:

- 기본 목록은 `submitted`, `page=1`, `pageSize=20`이며 상태 필터와 빈 목록을 제공한다.
- 활성 관리자만 상세와 자격증 signed read, 승인/반려에 접근한다.
- 반려 사유는 1자 이상 1,000자 이하이며, 같은 결정 재시도는 멱등, 반대 결정과 오래된
  신청서 결정은 충돌로 표시한다.
- 승인/반려 뒤 신청 상태와 앱 내 알림을 확인할 수 있고, 자격증 공개 URL이나 service-role
  값은 DOM, 콘솔, evidence에 노출하지 않는다.

## 24. 관리자 신고 검토

후보 경로:

```text
/admin/reports
```

목적:

- 신고 내용을 검토하고 조치한다.

주요 콘텐츠:

- 신고자
- 대상 유형
- 대상 상세
- 신고 사유
- 처리 상태
- 처리 메모

주요 액션:

- 검토 시작
- 해결
- 반려
- 관련 레슨/리뷰 숨김

연결 API:

- `GET /api/reports` with admin scope
- `POST /api/admin/reports/{reportId}/resolve`

## 25. 관리자 예약/결제 확인

후보 경로:

```text
/admin/reservations
```

목적:

- 분쟁, 환불, 결제 오류 예약을 확인한다.

주요 콘텐츠:

- 예약 상태
- 결제 상태
- 환불 상태
- 정산 상태
- 관련 신고
- 감사 로그

주요 액션:

- 관리자 취소
- 환불 처리 연결
- 정산 보류
- 상태 메모 기록

연결 API:

- `POST /api/admin/reservations/{reservationId}/status`
- `POST /api/refunds/{refundId}/process`
- `POST /api/settlements/{settlementId}/hold`

## 상태별 공통 UI

### 로딩

- 최종 레이아웃과 같은 모양의 스켈레톤을 사용한다.
- 결제와 예약 생성은 진행 중 상태를 명확히 표시한다.

### 빈 화면

| 화면 | 빈 상태 메시지 방향 |
|------|----------------------|
| 레슨 검색 | 조건을 줄이거나 다른 지역을 선택하게 한다 |
| 내 예약 | 첫 레슨 검색 CTA를 제공한다 |
| 지도자 레슨 | 첫 레슨 등록 CTA를 제공한다 |
| 정산 | 완료된 수업 이후 정산이 생성된다고 안내한다 |
| 신고 | 접수된 신고가 없음을 간결히 표시한다 |

### 오류

- 폼 오류는 필드 가까이에 표시한다.
- 예약/결제 오류는 다음 행동을 함께 보여준다.
- 외부 결제 오류는 재시도와 예약 만료 시간을 함께 보여준다.

### 권한 없음

- 로그인 필요
- 지도자 인증 필요
- 관리자 권한 필요
- 활동 제한 계정

## MVP 제외 화면

다음 화면은 Phase 2에서 설계한다.

- 운동 메이트 목록
- 운동 메이트 상세
- 운동 메이트 채팅방
- 운동 기록 대시보드
- 목표 관리
- 배지
- GPS/QR 출석
- 모바일 앱 전용 화면

## 구현 전 디자인 시스템 필요 항목

화면 구현 전에 `SPOLINK_디자인_시스템.md`에서 최소한 다음을 정의한다.

- 색상 토큰
- 타이포그래피
- 버튼
- 입력창
- 탭
- 필터 칩
- 카드 또는 리스트 행
- 상태 배지
- 가격 표시
- 예약 상태 표시
- 결제 상태 표시
- 알림
- 모달
- 빈 화면
- 오류 메시지
- 관리자 테이블

## API 매핑 요약

| 화면 | 핵심 API |
|------|----------|
| 홈 | `GET /api/sports`, `GET /api/lessons` |
| 로그인 | Supabase Auth, `GET /api/me` |
| 회원가입 | Supabase Auth |
| 온보딩 프로필 | `POST /api/profiles`, `GET /api/me` |
| 지도자 인증 | `PUT /api/coach-profile/me`, `POST /api/coach-profile/me/submit` |
| 레슨 검색 | `GET /api/lessons` |
| 레슨 상세 | `GET /api/lessons/{lessonId}`, `GET /api/lessons/{lessonId}/schedules` |
| 예약 확인 | `POST /api/reservations` |
| 결제 | `POST /api/payments/prepare`, `POST /api/payments/confirm` |
| 예약 상세 | `GET /api/reservations/{reservationId}` |
| 리뷰 작성 | `POST /api/reviews` |
| 신고 | `POST /api/reports` |
| 지도자 대시보드 | `GET /api/reservations?role=coach`, `GET /api/settlements` |
| 관리자 인증 | `GET /api/admin/coach-profiles`, approve/reject APIs |
| 관리자 신고 | `GET /api/reports`, `POST /api/admin/reports/{reportId}/resolve` |

## 다음 작업

1. `SPOLINK_디자인_시스템.md`
2. Next.js 프로젝트 스캐폴딩
3. Supabase 마이그레이션 SQL
4. MVP API Route Handler 구현
