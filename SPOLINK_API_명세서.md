# SPOLINK API 명세서 v0.1

## 문서 목적

SPOLINK MVP의 API 계약을 정의한다. 이 문서는 `SPOLINK_서비스_정책서.md`의 운영 정책과 `SPOLINK_ERD.md`의 테이블/상태값을 프론트엔드, Supabase, Edge Function 구현으로 옮기기 위한 기준 문서다.

## 구현 기준

- MVP는 `Supabase-first`로 구현한다.
- 인증은 Supabase Auth 세션을 기준으로 한다.
- 일반 CRUD는 Supabase RLS를 통과하는 클라이언트 요청 또는 Next.js Route Handler를 사용한다.
- 결제 검증, 환불, 정산 생성, 관리자 상태 변경은 service role 또는 Edge Function 경로에서만 처리한다.
- 외부 서비스별 세부 파라미터는 구현 직전에 공식 문서로 재확인한다.
- API 리소스명은 `SPOLINK_ERD.md`의 테이블명을 따른다.

### 지도자 대시보드 페이지 읽기 경계

- `/coach/dashboard`는 API endpoint가 아니라 승인된 지도자 전용 Server Component다.
- 페이지는 `readApprovedCoachPage("/coach/dashboard")`로 `coach_profiles.status = approved`와
  `profiles.status = coach_approved`를 먼저 확인한다.
- 현재 사용자 세션의 RLS-aware Supabase client로 기존 `lessons`, `lesson_schedules`,
  `reservations`, `settlements`, `reviews`, `notifications`를 지도자/프로필 소유 범위로 읽어
  화면 전용 read-model을 구성한다.
- 이 화면을 위해 새 Route Handler나 공개 응답 계약을 추가하지 않으며 service role을 사용하지
  않는다. 페이지 읽기는 dynamic/no-store로 유지한다.

## API 표기 규칙

| 표기 | 의미 |
|------|------|
| Public | 로그인 없이 접근 가능 |
| User | 로그인 사용자 |
| Coach | 승인된 지도자 |
| Admin | 관리자 |
| Edge | Edge Function 또는 service role 필요 |

## 공통 요청 규칙

### 인증

- 로그인 사용자는 Supabase Auth access token을 전송한다.
- 서버는 토큰에서 `auth.users.id`를 확인하고 `profiles.id`와 연결한다.
- 관리자 권한은 `profiles.role = admin`으로 판단한다.
- 지도자 권한은 `coach_profiles.status = approved`와 연결해 판단한다.

### 공통 헤더

```http
Authorization: Bearer <supabase_access_token>
Content-Type: application/json
```

- 상태를 변경하는 JSON Route Handler는 브라우저 요청의 `Origin`이 요청 URL 또는 보존된 `Host`와 같은 same-origin이어야 한다.
- 상태를 변경하는 JSON Route Handler는 `Content-Type: application/json`을 요구한다. `charset=utf-8` 같은 media type 파라미터는 허용한다.
- 상태 변경 요청은 저장 상태가 아니라 명령(`action`)을 받는다. 허용된 명령과 선택적 사유 외의
  `status`, actor/owner/reviewer ID, 처리 시각, 금액, 감사/알림 payload 필드는 422로 거절한다.
- actor와 owner는 검증된 claims와 잠근 DB 행에서, reviewer와 처리 시각은 활성 admin workflow와
  서버 시각에서, 예약·환불·정산 금액은 잠근 예약/결제/환불 행에서 파생한다.
- mutation 응답은 성공과 실패 모두 `Cache-Control: private, no-store`다. 동일 리소스·동일 action·
  동일 정규화 입력의 재시도만 기존 결과를 반환하며, 반대 action 또는 stale 상태는 409다.
- 일반 사용자와 활성 admin 모두 보호 테이블을 직접 `INSERT/UPDATE/DELETE`할 수 없다. 명시적으로
  grant된 `security definer` workflow RPC만 상태, reviewer, 시각, 금액과 부수 효과를 기록한다.

### 공통 응답

`meta`는 페이지네이션이나 부가 상태가 필요한 응답에서만 포함한다. 단일 리소스 생성/조회 응답은 개별 API 예시처럼 `data`만 반환할 수 있다.

성공:

```json
{
  "data": {}
}
```

실패:

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": []
  }
}
```

`details`는 검증 오류처럼 필드별 메시지가 필요한 경우 문자열 배열을 사용하고, 추가 설명이 없으면 빈 배열을 반환한다.

### 공통 에러 코드

| 코드 | HTTP | 의미 |
|------|------|------|
| `UNAUTHORIZED` | 401 | 로그인 필요 |
| `FORBIDDEN` | 403 | 권한 없음 |
| `NOT_FOUND` | 404 | 리소스 없음 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | JSON media type 아님 |
| `VALIDATION_ERROR` | 422 | 요청값 오류 |
| `CONFLICT` | 409 | 상태 충돌 또는 중복 |
| `PAYMENT_VERIFICATION_FAILED` | 400 | 결제 검증 실패 |
| `RESERVATION_EXPIRED` | 409 | 임시 예약 만료 |
| `CAPACITY_EXCEEDED` | 409 | 정원 초과 |
| `INVALID_STATE_TRANSITION` | 409 | 허용되지 않는 상태 전이 |
| `EDGE_SECRET_NOT_CONFIGURED` | 503 | 서버 간 Edge 인증 secret 설정 누락 |
| `SUPABASE_NOT_CONFIGURED` | 503 | 서버 Supabase 환경 설정 누락 |
| `EXTERNAL_PROVIDER_ERROR` | 502 | 외부 결제/지도/푸시 제공자 오류 |

## 리소스 우선순위

1. 인증/내 프로필
2. 지도자 인증
3. 레슨
4. 레슨 일정
5. 예약
6. 결제 검증
7. 환불
8. 정산
9. 리뷰
10. 신고/차단
11. 알림
12. 관리자

## 인증 / 프로필 API

공통 응답 규칙:

- 모든 신규 프로필 API 오류는 정확히 `{ "error": { "code": CODE, "details": [], "message": MESSAGE } }` 형식이며 추가 키를 넣지 않는다.
- 모든 응답은 `Cache-Control: private, no-store`를 사용하고, Supabase SSR 클라이언트가 갱신한 `Set-Cookie` 헤더를 그대로 전파한다.
- `POST /api/profiles`, `PATCH /api/profiles/me` 처리 순서는 `same-origin 검증 -> JSON Content-Type 검증 -> JSON 파싱 -> 정확한 요청 shape 검증 -> 공개 Supabase 설정 확인 -> 서버 검증 Auth 사용자 확인 -> 기존 프로필/계정 상태 확인 -> RLS 작업`이다.
- Origin이 누락되거나 malformed 또는 cross-origin이면 JSON media type·본문보다 먼저 403 `FORBIDDEN`, `Same-origin request required.`를 반환한다.
- Origin이 유효하지만 `Content-Type`이 누락되거나 `application/json`이 아니면 본문 파싱보다 먼저 415 `UNSUPPORTED_MEDIA_TYPE`, `Content-Type must be application/json.`을 반환한다. `application/json;charset=utf-8`을 포함한 media type 파라미터는 허용한다.
- 위 경계 거부에서는 Supabase 설정 확인, 클라이언트 생성, Auth claims 확인, 프로필 조회·변경을 호출하지 않는다.
- 공개 Supabase 설정이 없으면 503 `SUPABASE_NOT_CONFIGURED`, `Supabase is not configured.`를 반환한다.
- 인증 사용자는 `getClaims()`의 검증된 JWT claims 중 `sub`만 Auth 사용자 ID로 신뢰하며, `getUser()` 또는 service-role 클라이언트를 프로필 API 권한 확인에 사용하지 않는다.
- `profiles` 부재만 프로필 미완료 상태로 본다. 회원가입 시 최소 프로필 row를 만들지 않는다.
- `status = deleted` 또는 `deleted_at IS NOT NULL`이면 삭제 계정으로 본다.

`ProfileData`:

```json
{
  "id": "uuid",
  "role": "learner",
  "status": "active",
  "displayName": "홍길동",
  "realName": "홍길동",
  "phone": "010-0000-0000",
  "avatarPath": null,
  "defaultRegion": "서울특별시 강남구",
  "locationAgreedAt": "2026-07-19T00:00:00.000Z",
  "marketingAgreedAt": null,
  "deletedAt": null,
  "coachProfile": null
}
```

`coachProfile`이 있으면 정확히 다음 shape만 반환한다.

```json
{
  "id": "uuid",
  "status": "draft",
  "headline": null,
  "serviceRegion": "서울 강남구"
}
```

nullable DB 필드는 JSON `null`로 반환하고, 모든 timestamp는 UTC ISO-8601 문자열이다. 응답에 snake_case 또는 내부 필드를 넣지 않는다.

- Profile `defaultRegion`의 canonical non-null 값은 `lessonRegions`의 province/district canonical `queryValue`다.
- `profiles.default_region` 열은 nullable text로 유지한다. canonical 검증은 HTTP/profile UI 경계에서만 시행하며, 자동 마이그레이션이나 DB CHECK 제약을 추가하지 않는다.

공통 상태 매트릭스:

| 상태 | 응답 |
|------|------|
| Auth 사용자 없음 | 401 `UNAUTHORIZED`, `Authentication required.` |
| Auth 사용자 있음, `profiles` 없음 | `GET /api/me`, `PATCH /api/profiles/me`는 409 `PROFILE_REQUIRED`, `Profile setup required.`; `POST /api/profiles`는 최초 유효 생성 시 201 |
| `active`, `pending_coach`, `coach_approved`이고 `deleted_at IS NULL` | `GET /api/me`, `PATCH /api/profiles/me`는 200; `POST /api/profiles`는 409 `PROFILE_ALREADY_EXISTS`, `Profile already exists.` |
| `suspended`이고 `deleted_at IS NULL` | 403 `ACCOUNT_SUSPENDED`, `Account is suspended.` |
| `status = deleted` 또는 `deleted_at IS NOT NULL` | 403 `ACCOUNT_DELETED`, `Account is unavailable.` |
| Origin 누락, malformed, cross-origin | 403 `FORBIDDEN`, `Same-origin request required.` |
| Origin 유효, Content-Type 누락 또는 JSON 아님 | 415 `UNSUPPORTED_MEDIA_TYPE`, `Content-Type must be application/json.` |
| JSON 파싱 실패 | 422 `VALIDATION_ERROR`, `Request body must be valid JSON.` |
| shape 불일치, unknown key, 시스템 필드 입력 | 422 `VALIDATION_ERROR`, `Invalid profile request.` |

### 현재 사용자 조회

```http
GET /api/me
권한: User
테이블: profiles, coach_profiles
```

응답:

```json
{
  "data": "ProfileData"
}
```

규칙:

- 서버 검증 Auth 사용자 기준으로 RLS 소유 프로필을 조회한다.
- 프로필이 없으면 409 `PROFILE_REQUIRED`를 반환한다.
- 계정 제한/삭제 상태는 공통 상태 매트릭스를 따른다.
- 기존 legacy 값은 GET에서 그대로 반환하며 자동으로 canonical 값으로 변환하지 않는다.

### 프로필 생성

```http
POST /api/profiles
권한: User
테이블: profiles
```

요청:

```json
{
  "displayName": "홍길동",
  "realName": "홍길동",
  "phone": "010-0000-0000",
  "defaultRegion": "서울특별시 강남구",
  "locationAgreed": true,
  "marketingAgreed": false
}
```

검증:

- 요청은 정확히 `displayName`, `realName`, `phone`, `defaultRegion`, `locationAgreed`, `marketingAgreed` 여섯 키만 허용한다.
- 문자열은 trim한다.
- `displayName`은 2-30자, `realName`은 2-50자, `defaultRegion`은 2-80자다.
- POST의 `defaultRegion`은 필수이며 `null`일 수 없다. 앞뒤 공백을 trim한 canonical 값만 저장한다.
- 별칭, 자유 텍스트, 빈 문자열, `null`, 필드 생략은 422 `VALIDATION_ERROR`다.
- POST의 `phone`은 `01012345678` 또는 `010-1234-5678` 형식을 허용하며, 서버는 하이픈이
  포함된 canonical 형식으로 정규화한다. PATCH는 canonical 형식을 사용한다.
- `locationAgreed`, `marketingAgreed`는 boolean이며 둘 다 `false`일 수 있다.
- `location_agreed_at`, `marketing_agreed_at`은 해당 동의 값이 `true`이면 생성 트랜잭션 시각, `false`이면 `null`로 저장한다.
- 서버는 항상 `id = auth.uid`, `role = learner`, `status = active`로 삽입한다.
- `id`, `role`, `status`, `deletedAt`, `deleted_at`, `createdAt`, `updatedAt` 등 시스템 필드는 요청에서 받을 수 없다.
- 동일 `profiles.id` 중복 또는 동시 생성 unique violation `23505`는 409 `PROFILE_ALREADY_EXISTS`, `Profile already exists.`로 반환한다.
- 기타 DB 오류는 세부 정보를 숨기고 500 `INTERNAL_ERROR`, `Unable to complete profile request.`를 반환한다.

성공 응답:

```json
{
  "data": "ProfileData"
}
```

### 프로필 수정

```http
PATCH /api/profiles/me
권한: User
테이블: profiles
```

요청:

```json
{
  "displayName": "길동",
  "phone": "010-1111-2222",
  "defaultRegion": "서울특별시 강남구",
  "avatarPath": "profiles/user-id/avatar"
}
```

규칙:

- 본인 프로필만 수정 가능하다.
- 요청은 비어 있지 않은 object여야 하며 `displayName`, `realName`, `phone`, `defaultRegion`, `avatarPath`, `locationAgreed`, `marketingAgreed`만 허용한다.
- `displayName`은 프로필 생성과 같은 검증을 따르고 `null`일 수 없다.
- `realName`, `phone`, `avatarPath`는 `null`일 수 있다. null이 아닌 값은 프로필 생성 검증을 따른다.
- PATCH의 `defaultRegion`은 canonical 값, `null`, 또는 필드 생략만 허용한다. canonical 값은 trim 후 검증하며, `null`은 값을 지운다.
- `defaultRegion`을 생략한 unrelated PATCH는 기존 legacy 값을 그대로 보존한다.
- `avatarPath`는 `profiles/{auth.uid}/`로 시작하고, 그 뒤 1-180자의 ASCII 영문/숫자/`._/-`만 허용한다. 빈 세그먼트, `..`, 역슬래시, 선행 슬래시는 금지한다.
- 브라우저 사진 관리 UI는 공개 `profile-avatars` 버킷의 단일 `profiles/{auth.uid}/avatar` 객체만 사용한다. 버킷은 JPEG/PNG/WebP와 파일당 5 MiB 제한을 적용하고 insert/update/delete를 인증 소유자에게만 허용한다.
- 생략한 동의 필드는 기존 값을 유지한다. `true`는 현재 timestamp가 `null`일 때만 트랜잭션 시각을 설정하고, `false`는 `null`로 지운다.
- `id`, `role`, `status`, `deletedAt`, `deleted_at`, `createdAt`, `updatedAt` 등 시스템 필드는 요청에서 받을 수 없고, RLS/트리거로도 보호된다.
- 기타 DB 오류는 세부 정보를 숨기고 500 `INTERNAL_ERROR`, `Unable to complete profile request.`를 반환한다.

성공 응답:

```json
{
  "data": "ProfileData"
}
```

### 현재 계정 탈퇴

```http
DELETE /api/account
권한: User
Content-Type: application/json
```

요청:

```json
{ "confirmation": "탈퇴하기" }
```

- same-origin, JSON media type, strict body 검증을 순서대로 적용한다.
- 대상 사용자 ID와 탈퇴 시각은 클라이언트에서 받지 않고 인증 세션과 DB 시각에서 파생한다.
- 프로필 사진 객체 삭제가 실패하면 503 `ACCOUNT_CLEANUP_FAILED`로 중단한다.
- 성공 시 `withdraw_current_account()`가 개인정보·사용자 설정을 정리하고 프로필을 `deleted`로
  전환한 뒤 현재 브라우저 세션과 Auth flow cookie를 제거한다.
- 동일 계정의 재시도는 기존 `deleted_at`을 반환하는 멱등 성공이다.
- 성공 응답은 200 `{ "data": { "deletedAt": "UTC ISO", "idempotent": false } }`이며
  `Cache-Control: private, no-store`다.

## 지도자 인증 API

공통 계약:

- 인증 신청자의 `profiles.role`은 전 상태에서 `learner`로 유지한다. 상태 조합은
  `draft/rejected + active`, `submitted + pending_coach`, `approved + coach_approved`,
  `suspended + suspended`만 허용한다.
- mutation은 same-origin과 `application/json`을 확인한 후 strict schema로 파싱한다.
  owner, role/status, 제출/심사 시각, 심사자, 검증 시각과 반려 필드는 클라이언트 입력으로
  받지 않는다.
- 모든 개인 응답과 mutation 응답은 `Cache-Control: private, no-store`다.
- 자격증 bucket은 private `coach-certificates`다. object name은
  `<user-id>/<server-generated-uuid>.(png|jpg|pdf)`이고 DB `file_path`에는 bucket 이름이나
  공개 URL이 아닌 object name만 저장한다.
- PNG/JPEG/PDF만 허용하며 파일당 1 byte 이상 10MiB 이하, MIME/확장자/magic bytes가
  일치해야 한다. signed upload/read URL의 `expiresIn`은 300초다.

### 지도자 인증 신청 조회

```http
GET /api/coach-profile/me
권한: User
테이블: coach_profiles, coach_certificates
```

응답:

```json
{
  "data": {
    "id": "uuid",
    "status": "submitted",
    "headline": "테니스 입문 전문 코치",
    "serviceRegion": "서울 강남구",
    "certificates": [
      {
        "id": "uuid",
        "certificateName": "생활스포츠지도사",
        "issuer": "문화체육관광부",
        "certificateNumber": "optional",
        "verifiedAt": null
      }
    ]
  }
}
```

### 지도자 인증 신청 생성/수정

```http
PUT /api/coach-profile/me
권한: User
테이블: coach_profiles
```

요청:

```json
{
  "headline": "테니스 입문 전문 코치",
  "bio": "초보자 레슨을 전문으로 합니다.",
  "primarySportId": "uuid",
  "serviceRegion": "서울 강남구",
  "careerYears": 5,
  "bankName": "은행명",
  "bankAccountLast4": "1234",
  "payoutHolderName": "홍길동"
}
```

규칙:

- `submitted`, `approved`, `suspended` 상태에서는 일반 수정 범위를 제한한다.
- `draft`, `rejected`만 수정할 수 있으며 요청에 정의된 8개 필드 외 속성은 422다.
- 전체 계좌번호는 저장하지 않고 은행명, 계좌 끝 4자리, 예금주만 저장한다.

### 지도자 자격증 signed upload 생성

```http
POST /api/coach-profile/me/certificate-upload-url
권한: User (learner, active, draft/rejected)
```

요청:

```json
{
  "mimeType": "application/pdf",
  "sizeBytes": 1048576
}
```

응답:

```json
{
  "data": {
    "objectName": "<user-id>/<server-generated-uuid>.pdf",
    "uploadUrl": "private-signed-url",
    "expiresIn": 300
  }
}
```

`objectName`과 소유자 prefix는 서버가 생성하고 overwrite/upsert를 허용하지 않는다.

### 지도자 자격증 메타데이터 등록

```http
POST /api/coach-profile/me/certificates
권한: User
테이블: coach_certificates
```

요청:

```json
{
  "certificateName": "생활스포츠지도사",
  "issuer": "문화체육관광부",
  "certificateNumber": "optional",
  "objectName": "<user-id>/<server-generated-uuid>.png"
}
```

규칙:

- 파일 업로드 자체는 private Supabase Storage signed upload 정책으로 처리한다.
- 등록 시 실제 객체, owner prefix, 크기, MIME와 magic bytes를 다시 검증한다.
- DB에는 object name을 `file_path`로 저장하고 API 응답에는 경로나 signed URL을 포함하지 않는다.
- 메타데이터 등록 실패 시 해당 새 객체를 보상 삭제해 orphan을 남기지 않는다.

### 지도자 자격증 삭제

```http
DELETE /api/coach-profile/me/certificates/{certificateId}
권한: User (owner, draft/rejected)
```

요청 body는 `{}`다. 소유자의 draft/rejected 자격증만 메타데이터와 객체를 함께 삭제한다.
제출·승인·정지 상태, 다른 신청자의 ID와 존재하지 않는 ID는 각각 409/404로 처리하며
권한 밖 정보는 노출하지 않는다.

### 지도자 인증 제출

```http
POST /api/coach-profile/me/submit
권한: User
테이블: coach_profiles, coach_certificates, profiles
```

상태 전이:

```text
draft -> submitted
rejected -> submitted
```

검증:

- 기존 프로필의 실명, 연락처, 프로필 사진이 있어야 한다.
- 전문 종목, 한 줄 소개, 소개, 경력 연수, 활동 지역, 은행명, 계좌 끝 4자리, 예금주와
  검증 가능한 자격증 파일이 1개 이상 있어야 한다.
- `coach_profiles.draft/rejected -> submitted`와 `profiles.active -> pending_coach`를 한 RPC
  트랜잭션으로 수행하고 `profiles.role = learner`를 유지한다.
- 재제출은 이전 심사 필드를 지운다. 중복/동시 제출은 한 요청만 성공하고 나머지는 409다.

오류 코드:

| HTTP | code | 조건 |
|------|------|------|
| 401 | `UNAUTHORIZED` | 인증 claims 없음 |
| 403 | `FORBIDDEN`, `ACCOUNT_SUSPENDED`, `ACCOUNT_DELETED` | 역할/계정 제한 |
| 404 | `NOT_FOUND`, `COACH_APPLICATION_NOT_FOUND` | 신청서, 자격증 또는 객체 없음 |
| 409 | `PROFILE_REQUIRED`, `COACH_APPLICATION_CONFLICT` | 프로필 미완료 또는 stale/읽기 전용 상태 |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | JSON이 아닌 mutation |
| 422 | `VALIDATION_ERROR`, `COACH_APPLICATION_INCOMPLETE`, `COACH_CERTIFICATE_REQUIRED`, `COACH_CERTIFICATE_INVALID` | strict 입력/제출 조건/파일 검증 실패 |
| 503 | `SUPABASE_NOT_CONFIGURED` | 로컬 Supabase 미구성 |
| 500 | `INTERNAL_ERROR` | 내부 상세를 숨긴 실패 |

## 레슨 API

### 종목 목록

```http
GET /api/sports
권한: Public
테이블: sports
```

쿼리:

| 이름 | 설명 |
|------|------|
| `activeOnly` | 기본 true |

### 레슨 검색

```http
GET /api/lessons
권한: Public
테이블: lessons, sports, coach_profiles, reviews
```

쿼리:

| 이름 | 설명 |
|------|------|
| `sportId` | 종목 필터 |
| `region` | 지역 필터 |
| `keyword` | 제목/설명/지도자명 검색 |
| `minPrice` | 최소 가격 |
| `maxPrice` | 최대 가격 |
| `startsAfter` | 일정 시작 하한 |
| `page` | 페이지 |
| `pageSize` | 페이지 크기 |
| `cursor` | `createdAt DESC, id DESC` 순서를 유지하는 불투명 cursor |

응답:

```json
{
  "data": [
    {
      "id": "uuid",
      "title": "입문 테니스 레슨",
      "sport": {"id": "uuid", "name": "테니스"},
      "region": "서울 강남구",
      "priceAmount": 50000,
      "durationMinutes": 60,
      "location": {
        "latitude": 37.5012345,
        "longitude": 127.0312345
      },
      "coach": {
        "id": "uuid",
        "displayName": "홍코치",
        "ratingAverage": 4.8
      },
      "thumbnailUrl": null
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 0
  }
}
```

규칙:

- `lessons.status = active`만 공개 검색에 노출한다.
- 승인된 지도자의 레슨만 노출한다.
- 유효한 좌표 쌍이 있으면 `location`으로 반환하고, 없으면 `null`을 반환한다.

### 레슨 상세

```http
GET /api/lessons/{lessonId}
권한: Public
테이블: lessons, lesson_images, lesson_schedules, coach_profiles, reviews
```

규칙:

- 공개 사용자는 `active` 레슨만 조회한다.
- 지도자는 자신의 비공개 레슨을 조회할 수 있다.
- 관리자는 모든 레슨을 조회할 수 있다.

### 레슨 생성

### 레슨 주소 검색

```http
POST /api/maps/geocode
권한: 승인된 Coach
외부 연동: NAVER Maps Geocoding
```

요청은 same-origin JSON `{ "query": "테헤란로 123" }`이며 검색어는 2~200자다. 서버 전용
`NAVER_MAPS_CLIENT_ID`, `NAVER_MAPS_CLIENT_SECRET`으로 제공자를 호출하고 도로명/지번 주소와
위도·경도를 최대 5건 반환한다. 제공자 원문과 인증 정보는 반환하지 않으며 응답은
`Cache-Control: private, no-store`다. 미인증 `401`, 미승인 지도자 `403`, 미설정 `503`, 제공자
실패 `502`를 사용한다.

### 레슨 생성

```http
POST /api/lessons
권한: Coach
테이블: lessons
```

요청:

```json
{
  "sportId": "uuid",
  "title": "입문 테니스 레슨",
  "summary": "라켓 잡는 법부터 시작합니다.",
  "description": "초보자를 위한 1:1 레슨입니다.",
  "region": "서울 강남구",
  "address": "서울 강남구 ...",
  "placeName": "OO 테니스장",
  "latitude": 37.0,
  "longitude": 127.0,
  "durationMinutes": 60,
  "priceAmount": 50000,
  "capacity": 1,
  "preparation": "운동복, 물",
  "cancellationPolicySummary": "24시간 이상 70%, 3시간 이상 24시간 미만 50%, 3시간 미만 환불 불가"
}
```

기본 상태:

```text
draft
```

이미지는 레슨 생성 요청에 포함하지 않는다. 초안 ID를 받은 뒤 아래 레슨 이미지 전용 API를
선택 순서대로 호출한다.

`latitude`와 `longitude`는 둘 다 생략하거나 유효 범위의 숫자 쌍으로 보내야 한다. 좌표를 보낼
때는 `address`가 필수이며, 작성 RPC가 주소와 좌표를 한 트랜잭션으로 저장한다.

### 레슨 이미지 업로드 intent 생성

```http
POST /api/lessons/{lessonId}/images/upload-intents
권한: 승인된 Coach, 본인 draft/rejected 레슨
테이블: lesson_image_upload_intents, Supabase Storage
```

요청:

```json
{
  "mimeType": "image/jpeg",
  "sizeBytes": 5242880
}
```

`image/jpeg`, `image/png`, `image/webp`만 허용하고 파일당 `1..5,242,880` bytes(5 MiB),
레슨당 ready 이미지와 활성 intent 합계 최대 5개를 적용한다. 성공 `201`은 서버가 생성한
`intentId`, `<lessonId>/<objectId>.(jpg|png|webp)` 형태의 `objectName`, signed upload
`uploadUrl`/`token`, `expiresAt`, `expiresIn: 7200`을 반환한다. 브라우저는 bucket, path,
소유자, 순서, 상태를 지정하지 않으며 signed upload는 overwrite/upsert하지 않는다.

### 레슨 이미지 등록

```http
POST /api/lessons/{lessonId}/images
권한: 승인된 Coach, 본인 draft/rejected 레슨
```

요청:

```json
{
  "intentId": "uuid",
  "objectName": "lesson-uuid/object-uuid.jpg"
}
```

서버는 Storage 객체를 다시 내려받아 실제 크기, MIME, 확장자와 JPEG/PNG/WebP magic bytes를
검증한 뒤에만 `ready` 메타데이터를 원자적으로 등록한다. 성공 `201`은 현재 ready 이미지
목록을 `sortOrder` 순서로 반환한다. 검증 또는 등록 실패 시 해당 객체와 intent를 멱등 보상
정리하며, 같은 intent/object 재시도는 중복 이미지를 만들지 않는다.

### 레슨 이미지 순서와 표지 변경

```http
PATCH /api/lessons/{lessonId}/images/order
권한: 승인된 Coach, 본인 draft/rejected 레슨
```

요청:

```json
{
  "expectedImageIds": [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002"
  ],
  "orderedImageIds": [
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000001"
  ]
}
```

두 배열은 중복 없이 같은 최대 5개 ID 집합이어야 한다. 부모 레슨 잠금 아래 현재 순서가
`expectedImageIds`와 같을 때만 `0..n-1`로 조밀하게 재정렬하며 `sortOrder = 0`이 표지다.
오래된 배열은 `409 CONFLICT`이고 클라이언트는 최신 목록을 다시 불러온다.

### 레슨 이미지 삭제

```http
DELETE /api/lessons/{lessonId}/images/{imageId}
권한: 승인된 Coach, 본인 draft/rejected 레슨
```

요청:

```json
{
  "expectedImageIds": [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002"
  ]
}
```

삭제는 `ready -> deleting`으로 즉시 앱의 공개/소유자 ready 조회에서 제외하고 순서를 조밀하게
만든 뒤 Storage 객체를 제거하고 메타데이터를 마무리한다. 객체가 이미 없으면 성공으로 간주하며,
Storage 또는 finalize 실패 시 `deleting` 영수증을 남겨 같은 요청으로 안전하게 재시도한다.
성공 `200`은 남은 ready 이미지 목록을 반환한다.

네 mutation은 same-origin JSON만 받고 `Cache-Control: private, no-store`를 사용한다. 공통 오류는
`401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 CONFLICT`,
`415 UNSUPPORTED_MEDIA_TYPE`, `422 VALIDATION_ERROR`, `503 UNAVAILABLE`이다. 업로드 intent나
`deleting` 이미지가 남아 있으면 검토 요청도 `409`로 거절한다.

### 레슨 수정

```http
PATCH /api/lessons/{lessonId}
권한: Coach
테이블: lessons
```

규칙:

- 지도자는 본인 레슨만 수정 가능하다.
- `active` 레슨의 가격/시간/장소 변경은 확정 예약에 소급 적용하지 않는다.
- 예약 시점 가격은 `reservations.reserved_price_amount`에 저장한다.

### 레슨 상태 변경

```http
POST /api/lessons/{lessonId}/status
권한: Coach, Admin
테이블: lessons, audit_logs
```

요청:

```json
{
  "action": "approve",
  "reason": "관리자 승인"
}
```

상태 전이:

```text
draft -> pending_review
active -> paused
paused -> active
active -> closed

관리자 검토:
pending_review -> active
pending_review -> rejected
```

규칙:

- 코치는 본인 레슨을 `draft -> pending_review`, `active -> paused`, `paused -> active`, `active -> closed`로 변경할 수 있다.
- `pending_review -> active`와 `pending_review -> rejected`는 관리자 승인/반려 경로에서만 처리한다.
- action은 코치 `submit | pause | resume | close`, 관리자 `approve | reject`만 허용한다. 저장
  `lesson_status`와 coach/actor/status/timestamp 입력은 받지 않는다.
- 레슨 생성·수정·상태 변경과 일정 mutation은 `coach_profiles.status = approved`이고 연결된
  `profiles.status = coach_approved`인 본인 지도자만 수행한다.
- 상태 변경은 `audit_logs`에 남긴다.

## 레슨 일정 API

### 일정 생성

```http
POST /api/lessons/{lessonId}/schedules
권한: Coach
테이블: lesson_schedules
```

요청:

```json
{
  "startsAt": "2026-08-01T10:00:00+09:00",
  "endsAt": "2026-08-01T11:00:00+09:00",
  "capacity": 4
}
```

검증:

- `endsAt > startsAt`
- `capacity > 0`
- 승인된 본인 지도자의 레슨만 일정 생성 가능
- 일정 workflow는 일정 행을 먼저 잠근다. `confirmed`, `completed`, `no_show_user`,
  `no_show_coach`, `disputed` 예약이 하나라도 있으면 `lessonId`, 시작/종료 시각, capacity를
  변경할 수 없고, capacity는 어떤 경우에도 `reservedCount`보다 작게 만들 수 없다.
- `reservedCount`는 결제 확정/취소 workflow만 변경하며 요청 body에 포함할 수 없다.

### 예약 가능 일정 조회

```http
GET /api/lessons/{lessonId}/schedules
권한: Public
테이블: lesson_schedules, reservations
```

쿼리:

| 이름 | 설명 |
|------|------|
| `from` | 시작일 |
| `to` | 종료일 |
| `openOnly` | 기본 true |

응답 필드:

- `capacity`
- `reservedCount`
- `remainingCount`
- `isOpen`

## 예약 API

### 내 예약 목록

```http
GET /api/reservations
권한: User
테이블: reservations, lessons, lesson_schedules, payments, reviews
```

쿼리:

| 이름 | 설명 |
|------|------|
| `role` | learner 또는 coach |
| `status` | 예약 상태 |
| `page` | 페이지 |
| `pageSize` | 페이지 크기 |

규칙:

- 학습자는 본인 예약만 조회한다.
- 지도자는 자신의 레슨 예약만 조회한다.

### 예약 생성

```http
POST /api/reservations
권한: User
테이블: reservations, lesson_schedules, lessons
```

요청:

```json
{
  "lessonId": "uuid",
  "lessonScheduleId": "uuid"
}
```

응답:

```json
{
  "data": {
    "id": "uuid",
    "status": "pending_payment",
    "reservedPriceAmount": 50000,
    "paymentExpiresAt": "2026-08-01T09:10:00+09:00"
  }
}
```

상태:

```text
pending_payment
```

검증:

- 로그인 사용자가 학습자 상태여야 한다.
- 레슨이 `active`여야 한다.
- 일정이 열려 있어야 한다.
- 확정 예약 수가 정원을 넘지 않아야 한다.
- 같은 학습자가 같은 일정에 중복 확정 예약을 만들 수 없다.

동시성:

- 정원 확인과 `reserved_count` 갱신은 DB 함수 또는 Edge Function에서 원자적으로 처리한다.

### 예약 상세

> 계획 상태 / 현재 미구현
> 아래 경로, 권한, 테이블 상세는 목표 계약이며 현재 runtime Route Handler를 의미하지 않는다.

```http
GET /api/reservations/{reservationId}
권한: User
테이블: reservations, lessons, lesson_schedules, payments, refunds, settlements, reviews
```

권한:

- 예약자
- 관련 지도자
- 관리자

구현 상태:

- 일반 `GET /api/reservations/{reservationId}` Route Handler는 현재 미구현이다. 학습자 예약 완료 화면은 이 generic GET을 대체하거나 호출하지 않고 Server Component의 학습자 소유 읽기 모델을 사용한다.

### 예약 완료 화면의 서버 읽기와 캘린더

```http
GET /api/reservations/{reservationId}/calendar
권한: User (reservation learner owner)
```

- 예약 완료 화면은 `reservation.status` = `confirmed`와 `payment.status` = `paid`가 모두 저장 상태로 확인된 경우에만 성공 화면을 렌더링한다. `not_found`는 404, `pending`은 `/reservations/{reservationId}/payment`, `terminal`은 `/mypage/reservations/{reservationId}`로 이동하고 `mismatch`와 `read_failure`는 비식별 복구 화면을 사용한다.
- 캘린더 GET도 인증과 학습자 소유권 및 같은 strict `confirmed` + `paid` 조건을 다시 확인한다. 성공 응답은 `Cache-Control: private, no-store`이고 개인식별정보를 포함하지 않는다.
- `POST /api/reservations/{reservationId}/complete`는 지도자·관리자 수업 완료 lifecycle용 별도 API다. 예약 완료 화면과 캘린더 GET은 이 POST를 호출하지 않는다.

### 예약 취소

```http
POST /api/reservations/{reservationId}/cancel
권한: User
테이블: reservations, payments, refunds, settlements, audit_logs
```

요청:

```json
{
  "reason": "일정 변경"
}
```

- `reason`은 앞뒤 공백을 제거한 뒤 1자 이상 200자 이하여야 한다.
- 행위자, 취소 상태, 취소 시각, 환불 비율 또는 환불액은 요청으로 받지 않는다.

응답 (`200`):

```json
{
  "data": {
    "reservationId": "uuid",
    "status": "cancelled_by_user",
    "cancelledAt": "2026-07-14T05:30:00.000Z",
    "refund": {
      "id": "uuid",
      "amount": 7000,
      "status": "requested"
    }
  }
}
```

`data`는 정확히 `reservationId`, `status`, `cancelledAt`, `refund`를 반환한다. 환불 요청을 만들지 않는 `pending_payment` 취소 또는 환불액 0원 취소에서는 중첩 객체 대신 `"refund": null`을 반환한다. `refund`가 객체이면 정확히 `id`, `amount`, `status`를 포함하며 최초 상태는 `requested`다.

상태 전이:

```text
pending_payment -> cancelled_by_user
pending_payment -> cancelled_by_admin
confirmed -> cancelled_by_user
confirmed -> cancelled_by_coach
confirmed -> cancelled_by_admin
```

행위자 및 상태 규칙:

- 서버와 DB는 Supabase Auth 세션의 `auth.uid()`로 프로필을 찾고, 예약의 학습자, 관련 승인 지도자 또는 `profiles.role = admin`인지 판정한다. 클라이언트가 행위자를 선택할 수 없다.
- `pending_payment`는 예약 학습자와 관리자만 취소할 수 있다. 지도자는 `pending_payment` 예약을 취소할 수 없다.
- `confirmed`는 예약 학습자, 해당 레슨의 관련 승인 지도자, 관리자가 취소할 수 있다.
- 정지·탈퇴 사용자는 취소할 수 없고, 지도자는 `coach_profiles.status = approved`일 때만 관련 지도자로 인정한다.
- `pending_payment` 취소는 연결된 `payments.ready`를 `cancelled`로 바꾸고, 정원과 환불 요청을 변경하지 않는다.
- `confirmed` 취소는 확정 정원을 한 번만 복구하고 취소 행위자에 맞는 상태로 전이한다.

환불 규칙:

- 학습자 취소는 `lesson_schedules.starts_at`까지 남은 시간을 서버 시각으로 계산한다. `remaining >= 24h`는 `reserved_price_amount`의 70%, `3h <= remaining < 24h`는 50%, `remaining < 3h`는 0%다.
- 학습자 환불액은 수수료 차감 전 총 예약금액 `reserved_price_amount`에 비율을 적용한 뒤 1원 미만 소수점을 버림한다. 예: `10,001원 * 70% = 7,000.7원`은 `7,000원`이다.
- 지도자와 관리자 취소는 `reserved_price_amount`의 100%를 환불하며 지도자 취소는 정산에서 제외한다.
- 환불액이 0원보다 크면 취소 트랜잭션에서 `refunds.source = reservation_cancellation`, `status = requested`인 내부 환불 요청을 최대 한 번 생성한다. `requested_by`는 세션에서 판정한 학습자·지도자·관리자 프로필이다.
- 사용자 취소 API는 Toss Payments를 호출하지 않는다. 실제 Toss 환불과 `payments`/`refunds` 후속 상태 갱신은 나중의 Edge 환불 처리 단계에서 수행한다. 그때까지 승인 결제는 `paid`를 유지한다.
- 취소와 결제 승인이 경합해 취소 후 결제사 승인이 확인되면 `refunds.source = payment_confirmation_reconciliation`인 총 결제금액 100% 보상 환불 요청을 최대 한 번 생성하고, 실제 Toss 환불은 같은 후속 Edge 단계로 미룬다.

오류:

| 조건 | HTTP | 코드 | DB 오류 기준 |
|------|------|------|--------------|
| 잘못된 JSON, UUID 또는 공백/200자 초과 `reason` | 422 | `VALIDATION_ERROR` | 잘못된 사유는 `22023` |
| 인증 세션 없음 | 401 | `UNAUTHORIZED` | 인증 경계에서 차단 |
| 무관한 사용자, 정지·탈퇴 사용자, 미승인 지도자 또는 pending 지도자 취소 | 403 | `FORBIDDEN` | `42501` |
| 예약 없음 | 404 | `NOT_FOUND` | `P0002` |
| 취소할 수 없는 예약/결제 상태 | 409 | `INVALID_STATE_TRANSITION` | `P0001` |
| 이미 취소된 예약에 다른 행위자 또는 다른 사유로 재요청 | 409 | `CONFLICT` | `23505` |

같은 행위자와 같은 사유의 동일 취소 재요청은 부수 효과를 중복 생성하지 않고 기존 `200` 결과를 반환한다.

### 수업 완료 처리

```http
POST /api/reservations/{reservationId}/complete
권한: Coach, Admin
테이블: reservations, settlements, notifications, audit_logs
```

상태 전이:

```text
confirmed -> completed
```

요청 body는 정확히 `{}`이며 저장 `status`, 완료 시각, actor, 정산 금액을 받지 않는다.

규칙:

- 관련 지도자 또는 관리자만 완료 처리한다.
- 동일 완료 action 재시도만 멱등이며 no-show/취소/분쟁과의 경합은 잠근 예약 행에서 한 요청만
  승리하고 나머지는 409다.
- 완료 처리 후 정산 대기 데이터 생성을 예약한다.
- 리뷰 작성 가능 상태가 된다.

### 노쇼 처리

```http
POST /api/reservations/{reservationId}/no-show
권한: Coach, Admin
테이블: reservations, refunds, settlements, audit_logs
```

요청:

```json
{
  "action": "mark_learner_no_show",
  "reason": "수업 시작 후 대기 시간 초과"
}
```

상태 전이:

```text
confirmed -> no_show_user
confirmed -> no_show_coach
```

규칙:

- 학습자 노쇼는 원칙적으로 환불하지 않는다.
- 지도자 노쇼는 전액 환불과 정산 제외 대상이다.
- action은 `mark_learner_no_show | mark_coach_no_show`만 허용한다. 저장 status, 처리 시각,
  actor, 환불/정산 금액은 받지 않는다.
- KST 일정 시작 instant로부터 정확히 15분이 지난 뒤(`starts_at + interval '15 minutes' <=
  statement_timestamp()`)만 처리한다. 타임존 문자열이나 클라이언트 시각으로 판정하지 않는다.
- 동일 action과 정규화 reason의 재시도만 멱등이며 반대 action, stale 상태, 동시 완료 요청은 409다.

## 결제 API

### 결제 요청 생성

```http
POST /api/payments/prepare
권한: User
테이블: reservations, payments
```

요청:

```json
{
  "reservationId": "uuid"
}
```

응답:

```json
{
  "data": {
    "paymentId": "uuid",
    "provider": "toss",
    "providerOrderId": "spolink_reservation_uuid",
    "amount": 50000,
    "orderName": "입문 테니스 레슨"
  }
}
```

규칙:

- 예약 상태가 `pending_payment`여야 한다.
- 예약 만료 시간이 지나면 `RESERVATION_EXPIRED`.
- 결제 금액은 `reservations.reserved_price_amount`를 사용한다.
- 결제사별 클라이언트 파라미터는 구현 직전에 공식 문서를 확인한다.

### 결제 검증

```http
POST /api/payments/confirm
권한: Edge
테이블: payments, reservations, lesson_schedules, notifications, audit_logs
```

서버 간 호출 헤더:

```http
Authorization: Bearer <SPOLINK_EDGE_SECRET>
```

요청:

```json
{
  "reservationId": "uuid",
  "providerOrderId": "spolink_reservation_uuid",
  "providerPaymentKey": "provider-key",
  "amount": 50000
}
```

성공 상태 전이:

```text
payments.ready -> payments.paid
reservations.pending_payment -> reservations.confirmed
```

검증:

- 예약자와 결제 요청자가 일치해야 한다.
- 예약 금액과 결제 금액이 일치해야 한다.
- 결제사 승인 결과가 성공이어야 한다.
- 중복 승인 요청은 같은 결과를 반환하거나 `CONFLICT`로 처리한다.
- 확정 시 `lesson_schedules.reserved_count`를 증가시킨다.

실패:

- 결제사 검증 실패 시 `payments.failed`.
- 예약은 확정하지 않는다.

## 환불 API

`refunds.source`는 `manual`, `reservation_cancellation`, `payment_confirmation_reconciliation` 중 하나다. 예약 취소와 결제 승인 조정으로 생성되는 두 자동 source는 예약별·source별 최대 한 건이며, `manual` 환불은 이 자동 유일성 범위에 포함하지 않는다.

### 환불 요청

```http
POST /api/refunds
권한: User
테이블: refunds, payments, reservations
```

요청:

```json
{
  "reservationId": "uuid",
  "reason": "일정 변경"
}
```

규칙:

- 환불 가능 금액은 취소 정책과 예약 시작 시간을 기준으로 계산한다.
- 지도자 취소 또는 관리자 취소는 전액 환불이다.
- 환불 요청만 만들고 실제 결제사 환불 처리는 Edge 경로에서 수행한다.
- 예약 취소가 만드는 자동 환불은 `source = reservation_cancellation`, 취소 후 결제 승인 조정이 만드는 전액 보상 환불은 `source = payment_confirmation_reconciliation`을 사용한다.

### 환불 처리

```http
POST /api/refunds/{refundId}/process
권한: Edge, Admin
테이블: refunds, payments, reservations, settlements, audit_logs
```

trusted provider-result 요청은 `action: complete | fail`과 해당 action에 필요한 provider 결과 식별자
또는 bounded 실패 코드만 받는다. 환불 status/amount/requestedBy/processedAt, 결제 status, 정산 금액,
raw provider payload는 브라우저나 admin 입력으로 받지 않는다. 저장 refund ID와 동일 provider 결과의
재시도만 멱등이며, 결과 교체나 반대 action은 409다. 이 계약은 실제 Toss 호출을 의미하지 않는다.

상태:

```text
requested -> approved -> completed
requested -> failed
```

규칙:

- 결제사 환불 성공 후 `payments.status`를 `partially_refunded` 또는 `refunded`로 갱신한다.
- 환불 금액은 정산의 `refund_amount`에 반영한다.
- 누적 환불액은 잠근 결제 원금 이하이고, 정산은
  `netAmount = grossAmount - platformFeeAmount - paymentFeeAmount - refundAmount`를 만족해야 한다.

## 정산 API

### 내 정산 목록

```http
GET /api/settlements
권한: Coach, Admin
테이블: settlements, reservations, payments
```

쿼리:

| 이름 | 설명 |
|------|------|
| `status` | 정산 상태 |
| `from` | 생성일 시작 |
| `to` | 생성일 종료 |
| `page` | 페이지 |
| `pageSize` | 페이지 크기 |

규칙:

- 지도자는 자신의 `coach_profile_id` 정산만 조회한다.
- 관리자는 전체 조회 가능하다.
- local MVP가 실행할 수 있는 정산 action은 `approve | hold`뿐이다. `paid | failed`는 향후 payout
  provider workflow 예약 상태이며 현재 admin 또는 service-role 직접 write로도 전이하지 않는다.

### 정산 생성

```http
POST /api/settlements/generate
권한: Edge, Admin
테이블: reservations, payments, refunds, settlements
```

대상:

- `reservations.status = completed`
- 결제 상태가 `paid` 또는 `partially_refunded`
- 환불/분쟁 가능 기간이 지난 예약
- 기존 `settlements`가 없는 예약

기본 상태:

```text
pending
```

### 정산 승인

```http
POST /api/settlements/{settlementId}/approve
권한: Admin
테이블: settlements, audit_logs
```

상태 전이:

```text
pending -> approved
hold -> approved
```

### 정산 보류

```http
POST /api/settlements/{settlementId}/hold
권한: Admin
테이블: settlements, audit_logs
```

요청:

```json
{
  "reason": "분쟁 검토 중"
}
```

상태 전이:

```text
pending -> hold
```

## 찜 API

### 찜 추가/삭제

```http
POST /api/favorites
DELETE /api/favorites
권한: User (learner)
테이블: lesson_favorites, lessons
```

요청 body는 `{"lessonId":"uuid"}`만 허용한다. 서버는 세션의 학습자를 소유자로
파생하고 `lessons.status = active`인 레슨만 대상으로 한다. 중복 추가와 반복 삭제는
멱등 성공이며, 익명·타인 소유자·비활성 레슨·잘못된 ID·직접 테이블 쓰기는 거절한다.
읽기 모델은 `/mypage/favorites`에서 소유자 범위로 재검증한다.

## 리뷰 API

### 리뷰 작성

```http
POST /api/reviews
권한: User
테이블: reviews, reservations
```

요청:

```json
{
  "reservationId": "uuid",
  "rating": 5,
  "content": "친절하고 이해하기 쉬웠어요."
}
```

검증:

- 예약 상태가 `completed`여야 한다.
- 예약자만 작성할 수 있다.
- 예약당 리뷰는 1개만 허용한다.
- `rating`은 1-5다.

### 레슨 리뷰 목록

```http
GET /api/lessons/{lessonId}/reviews
권한: Public
테이블: reviews
```

규칙:

- `reviews.status = visible`만 공개 노출한다.

### 내 리뷰 관리 읽기

내 리뷰 관리를 위한 HTTP `GET`을 추가하지 않는다. `/mypage/reviews` Server Component가
쿠키 인식 Supabase 클라이언트로 읽고, 세션의 `auth.profile.id`를 소유자 값으로 전달한다.

읽기 계약:

- `reviewer_id`가 일치하는 `visible`과 `hidden`만 최신순으로 조회한다.
- `hidden`의 숨김 사유는 작성자 전용 응답 모델에만 포함하고 `deleted`는 제외한다.
- 일반 공개 `GET /api/lessons/{lessonId}/reviews`는 계속 `visible`만 반환한다.
- 이 계약과 브라우저 증거는 로컬 Supabase/Next 검증 범위이며 hosted, production, provider
  동작을 주장하지 않는다.

### 리뷰 숨김

```http
POST /api/admin/reviews/{reviewId}/hide
권한: Admin
테이블: reviews, audit_logs
```

요청:

```json
{
  "reason": "개인정보 노출"
}
```

상태 전이:

```text
visible -> hidden
```

## 신고 / 차단 API

### 신고 접수

```http
POST /api/reports
권한: User
테이블: reports
```

요청:

```json
{
  "targetType": "lesson",
  "targetId": "uuid",
  "reason": "허위 정보",
  "detail": "장소 정보가 실제와 다릅니다."
}
```

규칙:

- 자기 자신을 신고할 수 없다.
- `targetType`은 `user | coach | lesson | review | reservation`만 허용한다. 채팅이 구현되지 않은
  MVP에서는 `message`를 요청/DB enum 모두에서 거절한다.
- `reason`은 trim 후 1-100자, 선택적 `detail`은 trim 후 1-1,000자다. reporter/status/reviewer/
  reviewedAt/resolutionNote는 접수 요청에 포함할 수 없다.

### 내 신고 목록

```http
GET /api/reports
권한: User
테이블: reports
```

규칙:

- 일반 사용자는 자신이 접수한 신고만 조회한다.
- 관리자는 전체 신고를 조회한다.

관리자 목록은 다음 별도 경로를 사용한다.

```http
GET /api/admin/reports
권한: Admin
테이블: reports
```

### 차단 생성

```http
POST /api/blocks
권한: User
테이블: blocks
```

요청:

```json
{
  "blockedId": "uuid",
  "reason": "원치 않는 연락"
}
```

검증:

- 자기 자신을 차단할 수 없다.
- 중복 차단은 멱등 처리한다.

### 내 차단 목록

```http
GET /api/blocks
권한: User
테이블: blocks
```

차단 당사자만 자신의 차단 목록을 조회하며, 차단 대상의 이메일·전화번호 등 PII는
반환하지 않는다.

## 알림 API

### 알림 목록

```http
GET /api/notifications
권한: User
테이블: notifications
```

쿼리:

| 이름 | 설명 |
|------|------|
| `unreadOnly` | 읽지 않은 알림만 |
| `page` | 페이지 |
| `pageSize` | 페이지 크기 |

### 알림 읽음 처리

```http
POST /api/notifications/{notificationId}/read
권한: User
테이블: notifications
```

규칙:

- 본인 알림만 읽음 처리한다.
- 요청 body는 정확히 `{}`다. owner/readAt은 서버에서 파생하며 동일 읽음 재시도는 멱등이다.
- `data`는 알림 type별 연결 ID/status 키만 저장한다. 허용 키는
  `coachProfileId`, `submittedAt`, `decision`, `reservationId`, `paymentId`, `status`, `lessonId`,
  `reportId`, `refundId`, `settlementId`의 type별 부분집합이며, 이메일·전화·주소·provider key·
  token/cookie·raw payload 같은 키 또는 중첩 객체/배열은 거절한다.

응답은 `{ data: { items, meta } }`이며 `page`는 1 이상, `pageSize`는 1-100이다. `meta.nextCursor`가
`null`이면 다음 페이지가 없다. 목록과 읽음 처리 모두 `Cache-Control: private, no-store`를 사용한다.
읽음 처리는 본인 알림의 `readAt`만 서버 시각으로 갱신하고 이미 읽은 동일 요청은 성공으로 처리한다.
예약 완료/노쇼, 리뷰 요청, 신고 처리 결과, 지도자 상태, 환불 결과, 정산 상태 알림은 해당 상태
전이 트랜잭션 안에서 한 번만 기록된다.

### 푸시 구독 등록/해제

```http
POST /api/notifications/push-subscriptions
DELETE /api/notifications/push-subscriptions
권한: User
테이블: push_subscriptions
```

- same-origin JSON 요청만 허용하며 user ID는 세션에서 파생한다.
- 등록 body는 표준 Web Push `endpoint`, nullable `expirationTime`, `keys.p256dh`, `keys.auth`다.
- 삭제 body는 현재 브라우저의 `endpoint`만 받으며 owner-scoped RPC가 비활성화한다.
- VAPID private key, 다른 기기의 endpoint/key, delivery 상태는 브라우저에 반환하지 않는다.

### 푸시 전달 작업

```http
POST /api/notifications/push/deliver
권한: Edge
테이블: notifications, push_subscriptions, notification_push_deliveries
```

- body는 `{ "limit": 1..100 }`이며 기본값은 25다.
- service role 전용 claim RPC가 due row를 `FOR UPDATE SKIP LOCKED`로 lease한다.
- 성공은 `delivered`, 400/404/410은 구독 만료, 429/timeout/네트워크/5xx는 최대 5회
  지수 backoff 재시도, 그 밖의 provider 거절은 해당 delivery를 terminal 실패로 기록한다.
- 동일 claim token의 결과 재전송은 멱등이며 브라우저·일반 사용자 경로는 호출할 수 없다.

## 관리자 API

### 지도자 인증 대기 목록

```http
GET /api/admin/coach-profiles
권한: Admin
테이블: coach_profiles, coach_certificates, profiles
```

쿼리:

| 이름 | 설명 |
|------|------|
| `status` | draft, submitted, approved, rejected, suspended |
| `page` | 기본 1, 1 이상 |
| `pageSize` | 기본 20, 1-100 |

### 지도자 인증 상세

```http
GET /api/admin/coach-profiles/{coachProfileId}
권한: Active Admin
테이블: coach_profiles, coach_certificates, profiles, sports
```

신청 필드와 자격증 메타데이터만 반환한다. 자격증 `file_path`, raw bytes, signed URL과
전체 계좌번호는 반환하지 않는다.

### 관리자 자격증 private read

```http
GET /api/admin/coach-profiles/{coachProfileId}/certificates/{certificateId}
권한: Active Admin
```

응답은 등록된 해당 신청서 자격증의 `{data:{readUrl,expiresIn:300}}`다. 일반 사용자,
다른 신청서의 자격증 ID, 미등록 object는 403/404이며 public URL을 만들지 않는다.

### 지도자 인증 승인

```http
POST /api/admin/coach-profiles/{coachProfileId}/approve
권한: Admin
테이블: coach_profiles, profiles, audit_logs, notifications
```

상태 전이:

```text
coach_profiles.submitted -> coach_profiles.approved
profiles.pending_coach -> profiles.coach_approved
```

요청 body는 `{}`다. 같은 승인 재시도는 `idempotent: true`, 이미 반려된 신청서 승인은
409다. 성공 시 자격증 `verified_at`, 감사 로그 1건, 앱 내 알림 1건을 같은 트랜잭션에 기록한다.

### 지도자 인증 반려

```http
POST /api/admin/coach-profiles/{coachProfileId}/reject
권한: Admin
테이블: coach_profiles, profiles, audit_logs, notifications
```

요청:

```json
{
  "rejectionReason": "자격증 이미지가 선명하지 않습니다."
}
```

상태 전이:

```text
coach_profiles.submitted -> coach_profiles.rejected
profiles.pending_coach -> profiles.active
```

반려 시 사용자는 일반 학습자 계정 상태인 `active`로 복귀하며, 재제출하면 다시 `pending_coach`가 된다.
`rejectionReason`은 trim 후 1-1,000자다. 같은 반려 재시도는 멱등이며 반대 결정 또는
stale 상태는 409다. 승인/반려 권한은 HTTP claims와 `security definer` RPC에서 모두
활성 admin인지 확인하고, 브라우저 입력으로 심사자/상태/시각을 받지 않는다.

### 신고 처리

```http
POST /api/admin/reports/{reportId}/resolve
권한: Admin
테이블: reports, audit_logs, notifications
```

요청:

```json
{
  "action": "resolve",
  "resolutionNote": "레슨 정보를 숨김 처리했습니다."
}
```

허용 상태:

```text
submitted -> reviewing
reviewing -> resolved
reviewing -> rejected
```

action은 `start_review | resolve | reject`만 허용한다. reporter/status/reviewer/reviewedAt은 입력받지
않고 활성 admin claims와 서버 시각에서 파생한다. 동일 action 재시도만 멱등이다.

### 예약 상태 관리자 변경

```http
POST /api/admin/reservations/{reservationId}/status
권한: Admin
테이블: reservations, refunds, settlements, audit_logs, notifications
```

요청:

```json
{
  "action": "cancel",
  "reason": "서비스 장애로 인한 관리자 취소"
}
```

규칙:

- 관리자 상태 변경은 반드시 `audit_logs`에 기록한다.
- 환불 또는 정산 영향이 있으면 연결 작업을 생성한다.
- action은 `complete | mark_learner_no_show | mark_coach_no_show | open_dispute | cancel`만
  허용한다. 저장 status, actor, timestamp, refund/settlement amount는 받지 않으며 기존 domain RPC의
  잠금·권한·멱등 규칙을 그대로 사용한다.

## 파일 업로드 경계

- 범용 bucket/path 업로드 API는 제공하지 않는다. 레슨 이미지는 위의 레슨 전용 intent/등록
  API만 사용하고, 지도자 자격증은 지도자 인증 전용 API 계약을 사용한다.
- `lesson-images`는 공개 bucket이다. `ready` 메타데이터만 SPOLINK API/화면에 노출하지만,
  한 번 발급된 public CDN URL이 삭제 직후 모든 캐시에서 회수된다고 보장하지 않는다.
- 만료 intent와 고아 객체 정리는 `corepack pnpm lesson-images:cleanup`으로 로컬에서 멱등 실행하며
  이미지 mutation도 제한된 기회적 cleanup을 수행한다. Hosted staging schema/Storage 배포는
  완료됐지만 예약 scheduler/Edge Function은 후속 작업이며 현재 API로 기술하지 않는다.

## 상태 전이 보호 규칙

### 예약

허용:

- `pending_payment -> confirmed`
- `pending_payment -> cancelled_by_user`
- `pending_payment -> cancelled_by_admin`
- `confirmed -> cancelled_by_user`
- `confirmed -> cancelled_by_coach`
- `confirmed -> cancelled_by_admin`
- `confirmed -> completed`
- `confirmed -> no_show_user`
- `confirmed -> no_show_coach`
- `confirmed -> disputed`
- `completed -> disputed`

불허:

- `completed -> confirmed`
- `cancelled_* -> confirmed`
- `no_show_* -> confirmed`

### 결제

허용:

- `ready -> paid`
- `ready -> failed`
- `ready -> cancelled`
- `paid -> partially_refunded`
- `paid -> refunded`
- `partially_refunded -> refunded`

### 정산

허용:

- `pending -> hold`
- `pending -> approved`
- `hold -> approved`
- `hold -> failed`
- `approved -> paid`
- `approved -> failed`

## 보안 / RLS 메모

## 고우선 구현 route matrix

다음 route는 local MVP의 구현 및 focused contract 대상이다.

```text
PATCH /api/lessons/{lessonId}/schedules/{scheduleId}
POST /api/lessons/{lessonId}/schedules/{scheduleId}/close
POST|DELETE /api/favorites
GET /api/reservations/{reservationId}/calendar
POST /api/reservations/{reservationId}/complete
POST /api/reservations/{reservationId}/no-show
POST /api/admin/reviews/{reviewId}/hide
GET /api/admin/reports
GET|POST /api/blocks
GET /api/notifications
POST /api/notifications/{notificationId}/read
POST /api/refunds/{refundId}/claim
POST /api/refunds/{refundId}/process
GET /api/settlements
POST /api/settlements/generate
POST /api/settlements/generate/{reservationId}
POST /api/settlements/{settlementId}/approve
POST /api/settlements/{settlementId}/hold
GET /api/admin/reservations
GET /api/admin/reservations/{reservationId}
POST /api/admin/reservations/{reservationId}/status
```

각 route는 action-command만 받고 저장 상태·행위자·시각·금액은 DB workflow에서 파생한다.
SQL contract는 해당 forward migration의 RPC/RLS/unique barrier를, API contract는
HTTP/권한/재시도 오류를, browser contract는 관련 learner/coach/admin 화면의 상태를 검증한다.

- 공개 검색 API는 `lessons.status = active`, `coach_profiles.status = approved`만 반환한다.
- 본인 데이터 조회는 Supabase Auth uid와 `profiles.id` 일치를 기준으로 한다.
- 지도자는 `coach_profiles.user_id = profiles.id`로 소유권을 확인한다.
- 결제 검증, 환불 처리, 정산 생성은 클라이언트에서 직접 호출하지 못하게 한다.
- 관리자 API는 `profiles.role = admin` 확인 후 service role 경로에서 처리한다.
- `raw_payload`는 외부 제공자 응답을 저장하되 카드번호, 계좌번호, 토큰 등 민감정보는 저장하지 않는다.

## 외부 연동 확인 필요

구현 직전에 공식 문서로 확인할 항목:

- Toss Payments 결제 승인/취소 요청 파라미터
- Toss Payments webhook 또는 결제 콜백 처리 방식
- Supabase Storage signed upload 정책
- Supabase Edge Function 배포 및 secret 관리
- Firebase Cloud Messaging 발송 파라미터
- Naver Maps API 검색/지도 표시 파라미터

## API 구현 순서

1. `GET /api/me`
2. `POST /api/profiles`
3. `PUT /api/coach-profile/me`
4. `POST /api/coach-profile/me/certificates`
5. `POST /api/coach-profile/me/submit`
6. `GET /api/sports`
7. `GET /api/lessons`
8. `POST /api/lessons`
9. `POST /api/lessons/{lessonId}/schedules`
10. `POST /api/reservations`
11. `POST /api/payments/prepare`
12. `POST /api/payments/confirm`
13. `POST /api/reservations/{reservationId}/cancel`
14. `POST /api/reservations/{reservationId}/complete`
15. `POST /api/reviews`
16. `POST /api/reports`
17. 관리자 지도자 승인/반려 API
