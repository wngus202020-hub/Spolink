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
- 로그인 사용자: `/coach/apply`, `/mypage`, `/mypage/reservations`, `/mypage/reservations/[reservationId]`, `/mypage/favorites`, `/reservations/[reservationId]/complete`.
- 이 경로들은 현재 동작하는 화면이다. `/coach/apply`는 인증 신청 임시 저장, private `coach-certificates` 자격증 파일 업로드·등록·삭제, 심사 제출을 제공한다. 레슨 상세와 `/mypage/favorites`의 찜 mutation도 인증된 학습자 소유 범위에서 동작한다.

### 탐색, 검색, 미디어

- 지역 선택지는 고정된 공식 complete `전국 법정동_20260630` 스냅샷을 사용한다. 런타임
  공공데이터 호출과 거리순은 범위 밖이다. 지도 보기는 레슨에 저장된 좌표만 표시한다.
- 날짜 `YYYY-MM-DD`는 `Asia/Seoul`의 `[00:00, 다음 날 00:00)`로 해석한다. 그 날짜에 시작하는 open·non-full 일정으로 레슨 ID를 먼저 제한한 다음 public lesson limit을 적용한다.
- Supabase 읽기가 미구성일 때만 동일 matcher로 local demo fallback을 사용한다. 구성된 읽기의 성공 빈 결과는 빈 결과 그대로 보이고 demo 카드로 대체하지 않으며, 읽기 실패는 별도 오류 상태다.
- 모바일 검색은 compact trigger가 native `<dialog>` bottom sheet를 열고, 데스크톱 검색은 지역·종목·일정의 3개 segmented pill과 원형 검색 버튼을 사용한다. URL 쿼리, 새로고침, 뒤로 가기 후 선택값을 복원한다.
- 홈은 예약을 결정하기 전의 발견·신뢰 동선이다. 선택되지 않은 예약 가격, 예약 CTA, `MVP`·`Supabase` 같은 내부 구현 용어를 홈 발견 패널에 노출하지 않는다.
- 레슨 카드는 `photo | missing` 미디어 상태를 사용한다. 사진 로드 실패는 한 번만 neutral missing 표시로 전환하며 SVG를 사진 대체물로 쓰지 않는다.

### 인증 실패 복구와 보류 항목

- 비밀번호 재설정은 network, abort, non-2xx 실패 뒤 이메일 입력값을 유지하고 submit을 복구해 재시도할 수 있게 하며 generic alert에 focus한다. 회원가입 provider-error는 React 오류 상태 반영 뒤 첫 invalid field에 focus한다.
- 현재 확인된 서버 상태는 로컬 Supabase/Auth/RLS 전체 계약·E2E와 별도 Hosted Supabase/Vercel
  staging이다. staging에는 repository migration 34개, Auth Site/redirect 설정, 앱 runtime env가
  적용됐고 guest/readiness, signup·cross-user RLS smoke 및 Mailtrap custom SMTP 기반 이메일
  확인·복구 E2E가 통과했다. CI/CD, production deployment, actual Toss refund execution,
  payout network, maps, chat, push는 deferred다.

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

구현 경로:

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
- 기본 활동 지역은 `ProfileRegionPicker`에서 검색 후 canonical 지역을 명시적으로 선택한다. 입력한 free text 자체를 저장하거나 POST하지 않는다.
- 연락처는 하이픈 포함 또는 숫자만 입력할 수 있으며, 저장 요청 전에 canonical 형식으로 정규화한다.
- 선택 전에는 `POST /api/profiles`를 보내지 않으며, 필수 지역 오류와 지역 선택 control의 focus로 다시 선택하게 한다.
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
- 목록/지도 보기 전환
- 좌표가 등록된 레슨 마커와 위치 결과 목록

주요 액션:

- 필터 적용
- 목록/지도 전환과 마커·위치 결과 선택
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
- 지도 로딩/제공자 오류
- 좌표가 있는 레슨 없음

지도 보기 규칙:

- 기본은 목록 보기이며 현재 필터 결과를 그대로 유지한 채 지도 보기로 전환한다.
- NAVER Maps Dynamic Map은 서버가 전달한 application client ID로 비동기 로드한다.
- 지도에는 유효한 위·경도 쌍이 있는 공개 레슨만 표시하며, 목록 보기에는 모든 검색 결과를 유지한다.
- 마커와 오른쪽/하단 위치 결과는 동일한 선택 상태를 사용하고 선택 레슨 상세로 이동할 수 있다.
- 현재 위치, 거리순 정렬, 지도 경계 재검색은 후속 범위다.

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

구현 경로:

```text
/reservations/[reservationId]/complete
```

목적:

- 서버가 읽은 `reservation.status` = `confirmed` 및 `payment.status` = `paid`를 동시에 만족한 본인 예약만 예약 확정 화면으로 보여준다.

주요 콘텐츠:

- 예약 확정 상태
- 레슨명
- 일정
- 장소
- 지도자 이름과 수업 안내
- 취소/환불 진입
- 마이페이지 이동

주요 액션:

- 예약 상세 보기
- 캘린더 등록
- 레슨 더 보기

서버 읽기와 상태 이동:

- 이 페이지는 Server Component에서 학습자 소유 읽기 모델을 사용한다. 일반 `GET /api/reservations/{reservationId}`는 현재 미구현이며 호출하지 않는다.
- `not_found`: 존재하지 않거나 본인 소유가 아닌 예약은 동일한 404로 끝낸다.
- `pending`: 유효한 결제 대기 예약은 `/reservations/[reservationId]/payment`로 이동한다.
- `terminal`: 완료·취소·노쇼·분쟁 예약은 `/mypage/reservations/[reservationId]`로 이동한다.
- `mismatch`, `read_failure`: 예약 완료를 주장하지 않는 비식별 복구 화면에서 다시 시도와 내 예약 이동을 제공한다.

캘린더와 동작 경계:

- `GET /api/reservations/{reservationId}/calendar`는 인증된 본인의 예약 소유권을 재확인하고 strict `confirmed` + `paid` 검증 후에만 캘린더 파일을 반환한다. 응답은 `private, no-store`이며 개인식별정보를 반환하지 않는다.
- 예약 상세 보기와 취소·환불 안내는 기존 상세 화면으로 이동하며, 마이페이지와 레슨 더 보기 동선을 함께 제공한다.
- `POST /api/reservations/{reservationId}/complete`는 지도자·관리자 수업 완료 처리를 위한 별도 API이며, 이 학습자 화면과 캘린더 요청에서는 호출하지 않는다.

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

## 13. 마이페이지 프로필 수정

후보 경로:

```text
/mypage/profile
```

목적:

- 인증된 사용자가 기존 프로필을 확인하고, 현재 구현된 6개 편집 필드만 수정한다.
- 성공 후 사용자를 같은 `/mypage/profile` 화면에 유지하고 새로고침 후에도 저장값이 유지되는지 확인한다.

필드와 제약:

- 활동 이름 `displayName`: 필수, 앞뒤 공백 제거 후 2-30자.
- 실명 `realName`: 필수, 앞뒤 공백 제거 후 2-50자.
- 휴대폰 번호 `phone`: 필수, `010-1234-5678` 형식의 국내 휴대폰 번호.
- 기본 활동 지역 `defaultRegion`: 필수, `lessonRegions`의 시·도 또는 시·군·구 canonical `queryValue`만 허용한다.
- 위치 이용 동의 `locationAgreed`: 선택 동의 checkbox.
- 마케팅 수신 동의 `marketingAgreed`: 선택 동의 checkbox.

지역 검색과 legacy 복구:

- 지역 선택은 프로필 소유 `ProfileRegionPicker`가 담당하며 `searchRegionOptions()`로 시·도/시·군·구를 검색한다.
- 레슨 검색의 `전체` 선택지나 URL 필터 상태를 가져오지 않고, 입력한 free text 자체를 저장하지 않는다.
- 기존 row의 지역이 `null`이거나 catalog에 없는 legacy 값이면 자동 수정하지 않고 `지역을 다시 선택해 주세요`를 표시한다.
- legacy 상태에서는 사용자가 canonical 지역을 명시적으로 다시 선택해야 저장할 수 있다.

접근과 redirect:

- `readPageAuthProfile()`을 서버에서 1회 호출한다.
- 미인증 또는 Supabase 미설정 상태는 `/auth/login?next=/mypage/profile`로 이동한다.
- 프로필이 없는 인증 사용자는 `/onboarding/profile`로 이동한다.
- 정지 계정은 `/auth/restricted?reason=account-suspended`, 삭제 계정은 `/auth/restricted?reason=account-deleted`로 이동한다.

상태와 저장 흐름:

- `loading.tsx`는 프로필 편집 shell 크기의 skeleton을 보여 주고, `error.tsx`는 `reset`으로 다시 시도하는 한국어 복구 UI를 제공한다.
- 저장 버튼은 변경 없음, 변경값 invalid, 저장 중 상태에서 native `disabled`로 비활성화한다. Enter/requestSubmit 등으로 submit handler가 호출되어도 클라이언트 검증이 네트워크 mutation을 보내지 않고 첫 invalid field에 focus와 오류 안내를 제공한다.
- duplicate submit은 1회 요청으로 제한한다.
- 성공하면 `프로필 정보를 저장했어요.`를 `role="status"`로 알리고, baseline을 응답값으로 바꾼 뒤 `router.refresh()`를 호출한다.
- 성공 후 경로는 `/mypage/profile`에 머무르며 reload 후 저장값이 유지된다. 실패 시 입력값을 유지하고 재시도한다.

연결 API:

- `PATCH /api/profiles/me`
- 브라우저 mutation은 변경된 항목만 보낸다. 허용 key는 `displayName`, `realName`, `phone`, `defaultRegion`, `locationAgreed`, `marketingAgreed` 6개뿐이다.
- 초기값은 Server Component가 전달하며 중복 프로필 조회를 만들지 않는다.
- 프로필 사진은 `profile-avatars` Storage의 소유자 단일 경로에 업로드한 뒤 별도 `avatarPath` PATCH로 반영한다. 삭제는 프로필 경로를 먼저 지운 뒤 Storage 객체를 제거한다.
- 사진 관리 UI는 JPEG/PNG/WebP 5 MiB 제한, 업로드·삭제 상태, 오류 복구, 삭제 확인 dialog와 활동 이름 문자 fallback을 제공한다.

검증된 실행 표면:

- 명령: `corepack pnpm test:e2e:profile-edit`
- Todo7 관찰 기준: `desktop-chromium`, `tablet-chromium`, `mobile-chromium` 3개 프로젝트에서 총 9개 테스트 통과.
- 시각 증거: 성공 desktop/tablet/mobile 3장, 모바일 validation 1장, legacy desktop/tablet/mobile 3장을 포함한 정확한 7개 PNG 스크린샷. legacy는 각각 `null`, `서울 강남구`, prompt-injection 기존값을 안전한 재선택 상태로 보여 준다.

제외/미구현:

- PASS 본인 인증과 필수 프로필 필드 null clearing은 이 화면에서 제외/미구현이다.
- Hosted staging은 앱 runtime에 연결되어 있지만 이 프로필 편집 화면의 hosted browser E2E와
  provider-specific profile operation은 아직 검증 범위가 아니다.
- API가 nullable 필드를 지원하더라도 현재 UI는 필수 텍스트와 canonical 지역을 비워서 저장하는 흐름을 제공하지 않는다.

## 13-1. 계정 설정

구현 경로: `/mypage/settings`

- 인증 이메일, 계정 상태와 역할을 읽기 전용으로 표시한다.
- 비밀번호 재설정과 현재 브라우저 로그아웃으로 이동할 수 있다.
- 회원 탈퇴는 native dialog에서 `탈퇴하기` 문구를 정확히 입력해야 활성화한다.
- 탈퇴 성공 시 세션을 제거하고 홈으로 이동한다. 실패하면 dialog 입력을 유지하고 오류에 초점을
  이동해 재시도할 수 있다.
- 미인증·미설정은 `/auth/login?next=/mypage/settings`, 프로필 없음은 `/onboarding/profile`,
  정지·탈퇴 계정은 공통 제한 경계로 이동한다.
- 연결 API: `DELETE /api/account`, `POST /auth/logout`, 비밀번호 recovery flow.

## 14. 내 예약 목록

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

## 15. 예약 상세

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

- Server Component 학습자 소유 읽기 모델 (일반 `GET /api/reservations/{reservationId}`는 현재 미구현)
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

## 16. 리뷰 작성

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

## 16-1. 내 리뷰 관리

경로:

```text
/mypage/reviews
```

목적과 읽기 경계:

- Server Component가 인증 프로필 ID로 작성자 소유 리뷰를 읽는다. 새 공개 API는 추가하지 않는다.
- 작성자 본인의 `visible`/`hidden`과 숨김 사유를 표시하고 `deleted`는 표시하지 않는다.
- 공개 레슨 리뷰 API는 계속 `visible`만 제공한다.

상태:

| 상태 | 화면 동작 |
|------|-----------|
| ready | 최신순 리뷰, 공개 상태, 별점, 작성일, 조건부 레슨 링크와 페이지 이동 표시 |
| empty | 완료한 예약을 확인하는 CTA 표시 |
| out_of_range | 첫 페이지 복구 CTA 표시 |
| read_failure | 기대된 읽기 실패를 inline alert로 표시 |
| loading | `aria-busy` skeleton 표시 |
| error | 예기치 않은 오류와 `reset()` 재시도 표시 |

내비게이션:

- 마이페이지의 `리뷰 내역 보기`에서 진입한다.
- 리뷰 등록 성공 상태의 `내 리뷰 보기`에서 진입하며 자동 이동하지 않는다.

검증된 화면:

- 로컬 managed Supabase/Next/Chromium에서 공개·숨김/숨김 사유, 삭제 제외, 소유자 격리,
  공개 API visible-only와 복구 상태를 확인했다.
- 390×844, 768×1024, 1280×800에서 44px 이상 컨트롤, 줄바꿈, 페이지 왕복,
  가로 overflow 없음이 확인됐다.
- 검증 근거는 로컬 managed Supabase/Next/Chromium 실행이며 hosted, production, provider
  동작을 주장하지 않는다.

## 17. 지도자 대시보드

후보 경로:

```text
/coach/dashboard
```

목적:

- 승인된 지도자가 본인 소유의 오늘 일정, 예약 처리 현황, 정산, 최근 활동을 한곳에서 확인한다.

접근 및 내비게이션:

- `coach_profiles.status = approved`와 `profiles.status = coach_approved`를 모두 만족해야 한다.
- 승인된 지도자는 공용 헤더와 마이페이지의 `지도자 센터`에서 `/coach/dashboard`로 진입한다.
- 그 밖의 로그인, 프로필 설정, 신청 상태, 제한 계정은 공통 페이지 인증 경계의 안전한 경로로 이동한다.

주요 콘텐츠:

- 인증 상태
- 오늘 수업
- 예약 요청/확정 현황
- 완료 처리 대기
- 정산 대기 금액
- 최신 공개 리뷰 3개
- 최신 미확인 알림 3개와 전체 미확인 수

주요 액션:

- 레슨 등록
- 레슨 일정 관리
- 예약 관리
- 정산 관리

데이터 경계:

- 별도 지도자 대시보드 API를 만들지 않는다.
- 승인 경계를 먼저 통과한 Server Component가 현재 사용자 세션의 RLS-aware Supabase client로
  기존 `lessons`, `lesson_schedules`, `reservations`, `settlements`, `reviews`, `notifications`
  데이터를 지도자/프로필 소유 범위로 읽는다.
- 페이지는 `force-dynamic`, `force-no-store`, `revalidate = 0`이며 service role이나 학습자 PII,
  리뷰 작성자 식별자, 알림 raw payload를 노출하지 않는다.

상태:

- 데이터가 있는 운영 화면
- 섹션별 빈 상태
- 로딩 상태
- 오류 상태와 포커스된 한국어 제목
- 키보드로 실행 가능한 다시 시도 및 정상 화면 복구

검증된 화면 범위:

- 390x844, 768x1024, 1280x800에서 populated/empty/loading/error 상태를 검증한다.
- 390x844와 1280x800의 populated 상태는 dark color scheme도 검증한다.
- 관리형 실행 명령은 `corepack pnpm test:e2e:coach-dashboard`다.

## 18. 지도자 레슨 목록

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

## 19. 레슨 등록/수정

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
- 장소명
- 주소 검색 결과와 선택한 주소
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
- 도로명/지번 주소 검색 및 결과 선택
- 이미지 추가/다시 시도
- 표지 지정과 순서 변경
- 이미지 삭제 확인

연결 API:

- `GET /api/sports`
- `POST /api/lessons`
- `PATCH /api/lessons/{lessonId}`
- `POST /api/maps/geocode`
- `POST /api/lessons/{lessonId}/images/upload-intents`
- `POST /api/lessons/{lessonId}/images`
- `PATCH /api/lessons/{lessonId}/images/order`
- `DELETE /api/lessons/{lessonId}/images/{imageId}`

주소 상태와 복구:

- 주소 검색은 승인된 지도자 세션에서만 사용하며 결과를 선택하면 정규화된 주소와 위·경도를
  초안에 함께 저장한다.
- 검색어 입력과 저장 대상 주소를 분리하고, 결과 선택 전에는 좌표를 전송하지 않는다.
- 기존 좌표 없는 레슨의 주소는 유지할 수 있으며 선택한 주소를 지우면 주소와 좌표를 함께 비운다.
- 미설정·제공자 오류·검색 결과 없음은 폼 안에서 표시하고 다른 초안 필드는 유지한다.

이미지 상태와 복구:

- JPEG/PNG/WebP를 한 장당 5 MiB 이하, 레슨당 최대 5장 선택하며 첫 순서(`0`)를 표지로 표시한다.
- 새 레슨은 텍스트 초안을 한 번 만든 뒤 선택 순서대로 intent -> signed upload -> 등록을 직렬 실행한다.
- 중간 실패 시 성공한 서버 이미지와 실패/남은 로컬 파일을 유지하고 `이미지만 다시 시도`를 제공한다.
  재시도는 같은 초안 ID를 사용하고 이미 등록된 파일을 다시 업로드하지 않는다.
- 편집 화면의 이미지 저장/재시도는 텍스트 `expectedUpdatedAt` 저장과 별도다. `409`는 최신
  이미지 목록을 새로 불러오라는 안내를 표시한다.
- queued/uploading/failed 파일, 활성 intent 또는 deleting 이미지가 있으면 검토 요청을 막는다.
- 삭제는 확인 dialog를 거쳐 앱 조회에서 즉시 숨기고, 실패하면 멱등 재시도 가능한 상태를 표시한다.
- `draft|rejected`만 mutation 컨트롤을 사용한다. 나머지 레슨 상태는 이미지 목록만 읽는다.

공개 화면:

- 목록 카드는 ready 순서 0의 표지를 사용하고 상세는 ready 이미지 최대 5장을 순서대로 제공한다.
- 이미지가 없거나 로드에 실패하면 기존 안전한 대체 이미지를 사용하고 레이아웃 크기를 유지한다.
- `lesson-images`는 public bucket이므로 삭제된 URL의 모든 CDN 캐시가 즉시 회수된다고 안내하지 않는다.

## 20. 일정 관리

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

## 21. 지도자 예약 관리

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

## 22. 지도자 정산

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

## 23. 관리자 홈

후보 경로:

```text
/admin
```

목적:

- 관리자가 처리 대기 업무를 한 화면에서 본다.

주요 콘텐츠:

- 다섯 개 처리 대기 큐의 count-only 수와 각 목록 링크. 행 미리 보기, 개인식별정보(PII),
  금액, 자격증 경로, provider payload는 표시하지 않는다.

| 작업 큐 | 포함 상태 | 대상 화면 |
|---------|-----------|-----------|
| 지도자 심사 | `submitted` | `/admin/coaches?status=submitted&page=1&pageSize=20` |
| 레슨 승인 | `pending_review` | `/admin/lessons` |
| 신고 처리 | `submitted+reviewing` | `/admin/reports?status=open&page=1&pageSize=20` |
| 분쟁 예약 | `disputed` | `/admin/reservations?status=disputed&page=1&pageSize=20` |
| 정산 보류 | `hold` | `/admin/settlements?status=hold` |

접근과 읽기 경계:

- Server Component는 `auth.kind === "ready"`, `profile.role === "admin"`,
  `profile.status === "active"`인 활성 관리자만 읽는다. 그 밖의 계정 상태는 기존 로그인,
  온보딩, 제한 계정, 마이페이지 redirect 경계를 따른다.
- 각 페이지 요청에서 동시에 다섯 count-only 읽기를 시작한 best-effort load-time snapshot을
  표시한다. 강한 일관성의 strong transactional snapshot, RPC, view, migration은 추가하지 않는다.
- 어느 하나의 count 읽기라도 실패하면 부분값이나 0으로 대체하지 않고 전체 페이지 오류 상태로
  전환하며, retry 후 다시 읽는다. `0건`도 유효한 결과이며 대상 목록으로 가는 링크를 유지한다.
- 새 HTTP endpoint는 추가하지 않는다. Server Component의 내부 읽기 모델만 사용하며 mutation,
  polling, Realtime도 이 화면의 범위가 아니다.

범위 결정:

- 1A: 활성 관리자에게만 header의 `마이` 앞에 `/admin` 진입을 제공하며, 기존 관리자 화면 전체를
  공통 shell로 재구성하지 않는다.
- 2A: 정확히 다섯 개 count-and-link 타일만 표시하며 row preview를 추가하지 않는다.
- 3A: failing-first TDD plus managed responsive Playwright verification at 390/768/1280, local-only.
- 이 관리자 화면의 count snapshot과 browser evidence는 local-only Supabase 검증이다.
  Hosted Supabase staging에는 같은 route와 schema가 배포되어 있지만 관리자 desktop/mobile E2E는
  deferred다. Realtime delivery, payout 및 provider 기능도 deferred다.

권한:

- 활성 관리자 서버 검증

## 24. 관리자 지도자 인증

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

## 25. 관리자 신고 검토

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

## 26. 관리자 예약/결제 확인

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

## 27. 고우선 서비스 상태 표면

다음 상태는 현재 local MVP가 표시하고 서버 계약으로 검증한다.

| 표면 | 구현 상태와 주요 액션 |
|------|----------------------|
| 예약 상세/지도자 예약 | `confirmed`에서 `completed`, `no_show_user`, `no_show_coach`를 서버 시각과 KST 일정으로 판정하며 완료/노쇼 시각·행위자·금액은 입력받지 않는다. |
| 찜/리뷰 | 활성 레슨 찜 추가·삭제, 완료 예약 1건당 리뷰 1건, 관리자 리뷰 숨김을 제공한다. |
| 신고/차단 | `message` 대상은 제외하고 신고·차단·관리자 처리 및 앱 내 알림 결과를 제공한다. |
| 알림 | 소유자 목록/읽음 처리, 인증된 Realtime 갱신, 사용자 동의 Web Push 토글과 private 구독을 제공한다. 로컬 E2E는 replication-ready 이후 새 알림과 outbox 생성을 확인하며 hosted migration·worker scheduler·외부 Push Service 발송 검증은 후속이다. |
| 환불/정산 | 내부 환불은 `requested/approved/completed/failed` reconciliation 계약만 제공하고, 정산은 `pending/hold/approved`까지만 제공한다. Toss refund execution과 payout은 제공하지 않는다. |

각 상태의 HTTP payload, 허용 action, DB 테이블/RPC, 오류와 재시도 규칙은
`SPOLINK_API_명세서.md`와 `SPOLINK_ERD.md`를 단일 계약으로 사용한다.

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
| 예약 완료 | Server Component 학습자 소유 읽기 모델, `GET /api/reservations/{reservationId}/calendar` |
| 예약 상세 | Server Component 학습자 소유 읽기 모델 (일반 `GET /api/reservations/{reservationId}`는 현재 미구현) |
| 리뷰 작성 | `POST /api/reviews` |
| 신고 | `POST /api/reports` |
| 지도자 대시보드 | 별도 API 없음. 승인된 지도자의 RLS-aware Server Component가 기존 레슨·일정·예약·정산·리뷰·알림 읽기 모델을 소유 범위로 구성 |
| 관리자 인증 | `GET /api/admin/coach-profiles`, approve/reject APIs |
| 관리자 신고 | `GET /api/reports`, `POST /api/admin/reports/{reportId}/resolve` |

## 다음 작업

1. `SPOLINK_디자인_시스템.md`
2. Next.js 프로젝트 스캐폴딩
3. Supabase 마이그레이션 SQL
4. MVP API Route Handler 구현
