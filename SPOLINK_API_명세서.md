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
  "defaultRegion": "서울 강남구",
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
  "defaultRegion": "서울 강남구",
  "locationAgreed": true,
  "marketingAgreed": false
}
```

검증:

- 요청은 정확히 `displayName`, `realName`, `phone`, `defaultRegion`, `locationAgreed`, `marketingAgreed` 여섯 키만 허용한다.
- 문자열은 trim한다.
- `displayName`은 2-30자, `realName`은 2-50자, `defaultRegion`은 2-80자다.
- `phone`은 `^01[016789]-[0-9]{3,4}-[0-9]{4}$`를 만족해야 한다.
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
  "defaultRegion": "서울 송파구",
  "avatarPath": "profiles/user-id/avatar.png"
}
```

규칙:

- 본인 프로필만 수정 가능하다.
- 요청은 비어 있지 않은 object여야 하며 `displayName`, `realName`, `phone`, `defaultRegion`, `avatarPath`, `locationAgreed`, `marketingAgreed`만 허용한다.
- `displayName`은 프로필 생성과 같은 검증을 따르고 `null`일 수 없다.
- `realName`, `phone`, `defaultRegion`, `avatarPath`는 `null`일 수 있다. null이 아닌 값은 프로필 생성 검증을 따른다.
- `avatarPath`는 `profiles/{auth.uid}/`로 시작하고, 그 뒤 1-180자의 ASCII 영문/숫자/`._/-`만 허용한다. 빈 세그먼트, `..`, 역슬래시, 선행 슬래시는 금지한다.
- 생략한 동의 필드는 기존 값을 유지한다. `true`는 현재 timestamp가 `null`일 때만 트랜잭션 시각을 설정하고, `false`는 `null`로 지운다.
- `id`, `role`, `status`, `deletedAt`, `deleted_at`, `createdAt`, `updatedAt` 등 시스템 필드는 요청에서 받을 수 없고, RLS/트리거로도 보호된다.
- 기타 DB 오류는 세부 정보를 숨기고 500 `INTERNAL_ERROR`, `Unable to complete profile request.`를 반환한다.

성공 응답:

```json
{
  "data": "ProfileData"
}
```

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
  "status": "active",
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
- 본인 레슨만 일정 생성 가능

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

```http
GET /api/reservations/{reservationId}
권한: User
테이블: reservations, lessons, lesson_schedules, payments, refunds, settlements, reviews
```

권한:

- 예약자
- 관련 지도자
- 관리자

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

규칙:

- 관련 지도자 또는 관리자만 완료 처리한다.
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
  "target": "learner",
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

상태:

```text
requested -> approved -> completed
requested -> failed
```

규칙:

- 결제사 환불 성공 후 `payments.status`를 `partially_refunded` 또는 `refunded`로 갱신한다.
- 환불 금액은 정산의 `refund_amount`에 반영한다.

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

### 리뷰 숨김

```http
POST /api/reviews/{reviewId}/hide
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
- `targetType`은 ERD의 허용 값을 따른다.

### 내 신고 목록

```http
GET /api/reports
권한: User
테이블: reports
```

규칙:

- 일반 사용자는 자신이 접수한 신고만 조회한다.
- 관리자는 전체 신고를 조회한다.

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
  "status": "resolved",
  "resolutionNote": "레슨 정보를 숨김 처리했습니다."
}
```

허용 상태:

```text
submitted -> reviewing
reviewing -> resolved
reviewing -> rejected
```

### 예약 상태 관리자 변경

```http
POST /api/admin/reservations/{reservationId}/status
권한: Admin
테이블: reservations, refunds, settlements, audit_logs, notifications
```

요청:

```json
{
  "status": "cancelled_by_admin",
  "reason": "서비스 장애로 인한 관리자 취소"
}
```

규칙:

- 관리자 상태 변경은 반드시 `audit_logs`에 기록한다.
- 환불 또는 정산 영향이 있으면 연결 작업을 생성한다.

## 파일 업로드 API

### 업로드 URL 요청

```http
POST /api/storage/signed-upload-url
권한: User
테이블: 없음, Supabase Storage
```

요청:

```json
{
  "bucket": "coach-certificates",
  "path": "coach-certificates/user-id/cert.png",
  "contentType": "image/png"
}
```

규칙:

- 허용 bucket과 path prefix를 서버에서 검증한다.
- 자격증 파일은 본인 path에만 업로드 가능하다.
- 업로드 후 관련 메타데이터 API를 호출해 DB 레코드를 만든다.

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
