# SPOLINK 디자인 시스템 v0.1

## 문서 목적

SPOLINK MVP의 시각 언어, 디자인 토큰, 컴포넌트 규칙, 상태 표현, 모션, 접근성 기준을 정의한다. 이 문서는 `SPOLINK_화면_설계.md`의 현재 Next.js 구현과 이후 화면 확장 모두의 기준 문서다.

현재 구현은 이 문서의 light/dark CSS 변수와 접근성 규칙을 사용한다. 구현된 표면과 보류된 provider mutation의 경계는 `SPOLINK_화면_설계.md` 및 `AGENTS.md`와 함께 유지한다.

## 참고 방향

읽은 기준:

- `SPOLINK_Brand_Identity_v1.0.md`
- `SPOLINK_서비스_정책서.md`
- `SPOLINK_화면_설계.md`
- `frontend/references/design/design-system-architecture.md`
- `frontend/references/design/taste-skill.md`
- `frontend/references/design/airbnb.md`

디자인 읽기:

SPOLINK는 스포츠 과시형 브랜드가 아니라 가까운 지역에서 믿을 수 있는 지도자와 수업을 예약하는 생활형 스포츠 마켓플레이스다. 핵심 화면은 사진 중심 탐색, 명확한 예약 패널, 숨기지 않는 가격/환불/상태 정보, 지도자 신뢰 표시다.

방향:

- Layer A: `taste-skill`
- Layer B: `airbnb`
- 적용 방식: Airbnb의 지역 기반 탐색, 사진 중심 카드, 단일 강한 액센트, 예약 패널 문법을 참고하되 SPOLINK의 스포츠, 안전, 지도자 인증 문맥에 맞게 재구성한다.

디자인 다이얼:

| 항목 | 값 | 이유 |
|------|----|------|
| Design variance | 5 | 탐색 화면은 친근하게, 결제/관리 화면은 예측 가능해야 한다 |
| Motion intensity | 3 | 예약과 결제 신뢰가 우선이므로 장식 모션보다 상태 전환 피드백을 우선한다 |
| Visual density | 5 | 레슨 목록과 관리자 화면은 정보가 많지만 소비자 화면은 여백을 유지한다 |

## 1. Atmosphere & Identity

SPOLINK는 가까운 동네에서 바로 운동을 시작할 수 있게 해주는 신뢰형 스포츠 예약 플랫폼처럼 느껴져야 한다. 첫인상은 밝고 안전하며, 탐색은 가볍고, 예약과 결제는 단단해야 한다. 시그니처는 `Near Action Coral` 액센트와 사진 중심 레슨 카드, 그리고 지도자 인증/예약 상태를 명확히 보여주는 투명한 상태 UI다.

브랜드 가치 반영:

| 가치 | UI 해석 |
|------|---------|
| Trust | 지도자 인증, 환불 기준, 결제 금액, 신고 진입점을 숨기지 않는다 |
| Nearby | 지역, 거리, 일정, 지도 진입을 검색 초반에 배치한다 |
| Community | 리뷰와 지도자 프로필을 거래 정보와 함께 보여준다 |
| Growth | 리뷰, 다음 예약, 활동 기록으로 이어질 공간을 남긴다 |
| Simplicity | 한 화면에서 한 가지 주요 결정을 요구한다 |

브랜드 문구:

- 기본 슬로건: `가장 가까운 스포츠 플랫폼.`
- 보조 카피: `배우고, 함께하고, 활동하는 모든 순간을 연결합니다.`

## 2. Color

### 원칙

- 액센트는 하나만 강하게 쓴다.
- `Near Action Coral`은 검색, 예약, 결제 CTA에만 사용한다.
- 상태 색상은 의미 전달에만 사용한다.
- 사진, 텍스트, 상태 배지가 서로 경쟁하지 않게 표면은 밝고 중립적으로 둔다.
- 모든 색상은 아래 토큰에서 가져온다. 구현 중 새 색상이 필요하면 먼저 이 표를 갱신한다.

### Palette

| Role | Token | Light | Dark | Usage |
|------|-------|-------|------|-------|
| Surface/canvas | `--surface-canvas` | `#ffffff` | `#121212` | 기본 배경 |
| Surface/subtle | `--surface-subtle` | `#f7f7f5` | `#1b1b1b` | 보조 배경, 푸터, 빈 화면 |
| Surface/elevated | `--surface-elevated` | `#ffffff` | `#242424` | 모달, 팝오버, 예약 패널 |
| Surface/inset | `--surface-inset` | `#f0f2ef` | `#2d2d2a` | 입력창 내부, 스켈레톤 |
| Text/primary | `--text-primary` | `#222222` | `#f7f7f2` | 제목, 본문 핵심 |
| Text/secondary | `--text-secondary` | `#5f6360` | `#b8bbb5` | 설명, 메타 정보 |
| Text/tertiary | `--text-tertiary` | `#8a8f89` | `#858a83` | 비활성, 보조 힌트 |
| Text/on accent | `--text-on-accent` | `#ffffff` | `#222222` | 액센트 배경 위 텍스트 |
| Border/default | `--border-default` | `#ddddda` | `#383a36` | 카드, 입력창, 표 |
| Border/subtle | `--border-subtle` | `#ededeb` | `#2f312d` | 약한 구분선 |
| Accent/primary | `--accent-primary` | `#d44055` | `#ff6b70` | 주요 CTA, 활성 탭 |
| Accent/hover | `--accent-hover` | `#d93b45` | `#ff8185` | 주요 CTA hover |
| Accent/pressed | `--accent-pressed` | `#c92f38` | `#f2555a` | 주요 CTA active |
| Accent/soft | `--accent-soft` | `#fff0f1` | `#3a2022` | 액센트 배경, 선택 상태 |
| Sport/field | `--sport-field` | `#2f7d59` | `#5ac58e` | 성공, 활동 완료 |
| Sport/court | `--sport-court` | `#3468c9` | `#7aa6ff` | 정보, 링크 |
| Status/success | `--status-success` | `#207a4d` | `#5ad08d` | 결제 완료, 승인 |
| Status/warning | `--status-warning` | `#b56a00` | `#ffb84d` | 심사 중, 환불 대기 |
| Status/error | `--status-error` | `#c13515` | `#ff765c` | 결제 실패, 반려, 신고 |
| Status/info | `--status-info` | `#3468c9` | `#7aa6ff` | 안내, 정책 링크 |
| Overlay/scrim | `--overlay-scrim` | `rgba(0, 0, 0, 0.48)` | `rgba(0, 0, 0, 0.64)` | 모달 배경 |

### Color Usage Rules

- 페이지당 `--accent-primary`로 채워진 큰 요소는 한 viewport 안에서 1-2개를 넘기지 않는다.
- 카드 배경은 기본적으로 `--surface-canvas`를 유지하고, 필요한 경우 구분선과 여백으로 계층을 만든다.
- 관리자 화면은 상태 색상 남용을 피하고 표 행의 텍스트, 배지, 필터로 의미를 구분한다.
- 위험 액션은 `--status-error`를 사용하되, 확인 모달 없이 바로 실행하지 않는다.
- 위치/거리 정보는 액센트가 아니라 `--text-secondary`와 아이콘으로 표현한다.

### Accessible Light Action Contract

- Light Coral base는 `#d44055`, hover는 `#d93b45`, pressed는 `#c92f38`, foreground는 `#ffffff`다.
- base, hover, pressed 각각은 `#ffffff` 전경과 WCAG AA `4.5:1` 이상 대비를 유지해야 한다. 이 계약은 primary CTA와 원형 검색 submit 모두에 적용한다.

## 3. Typography

### Font Stack

SPOLINK는 한국어 화면이 중심이므로 한글 가독성을 우선한다.

| Role | Stack | Notes |
|------|-------|-------|
| Primary | `Pretendard Variable, Pretendard, system-ui, -apple-system, BlinkMacSystemFont, sans-serif` | 한국어 UI 기본 |
| Mono | `JetBrains Mono, SFMono-Regular, ui-monospace, Menlo, monospace` | 금액, 코드성 식별자, 관리자 로그 |

구현 기준:

- Next.js 구현 시 `next/font/local` 또는 self-hosted font를 우선 검토한다.
- 외부 폰트 링크를 바로 추가하지 않는다.
- `Inter`를 기본값으로 두지 않는다.

### Scale

| Level | Size | Weight | Line Height | Tracking | Usage |
|-------|------|--------|-------------|----------|-------|
| Display | `48px` | 700 | 1.12 | 0 | 홈 첫 화면, 주요 브랜드 문구 |
| H1 | `36px` | 700 | 1.22 | 0 | 페이지 제목 |
| H2 | `28px` | 700 | 1.32 | 0 | 섹션 제목 |
| H3 | `22px` | 700 | 1.36 | 0 | 카드 그룹, 상세 블록 |
| H4 | `18px` | 700 | 1.4 | 0 | 카드 제목, 폼 섹션 |
| Body/lg | `18px` | 500 | 1.6 | 0 | 소개 문장 |
| Body | `16px` | 500 | 1.55 | 0 | 기본 본문 |
| Body/sm | `14px` | 500 | 1.5 | 0 | 메타 정보, 보조 설명 |
| Caption | `12px` | 500 | 1.4 | 0 | 작은 라벨, 보조 배지 |
| Number/lg | `24px` | 700 | 1.25 | 0 | 가격, 평점, 대시보드 숫자 |
| Number/sm | `14px` | 600 | 1.4 | 0 | 금액, 정산, 표 숫자 |

### Typography Rules

- 본문은 14px 아래로 내리지 않는다.
- 버튼 라벨은 한 줄로 유지한다.
- 한글 UI에서는 과한 자간을 쓰지 않는다.
- 대문자 영문 라벨은 관리자 표의 짧은 enum 표시를 제외하고 피한다.
- 가격과 정산 금액은 숫자와 단위를 같은 행에서 읽히게 한다.

## 4. Spacing & Layout

### Base Unit

모든 간격은 4px 기반으로 둔다.

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | `4px` | 아이콘과 라벨 사이 |
| `--space-2` | `8px` | 작은 행 간격, 필드 내부 |
| `--space-3` | `12px` | 카드 메타 정보, 버튼 내부 |
| `--space-4` | `16px` | 기본 패딩, 모바일 좌우 여백 |
| `--space-5` | `20px` | 폼 그룹 |
| `--space-6` | `24px` | 카드, 예약 패널 기본 패딩 |
| `--space-8` | `32px` | 섹션 내부 그룹 간격 |
| `--space-10` | `40px` | 화면 블록 간격 |
| `--space-12` | `48px` | 주요 섹션 간격 |
| `--space-16` | `64px` | 데스크톱 페이지 상하 여백 |
| `--space-20` | `80px` | 홈 첫 화면 최대 여백 |

### Grid

| 항목 | 기준 |
|------|------|
| Max content width | `1280px` |
| Marketing content width | `1120px` |
| Detail content width | `1180px` |
| Admin content width | `1440px` |
| Mobile margin | `16px` |
| Tablet margin | `24px` |
| Desktop gutter | `24px` |

### Breakpoints

| Token | Width | Rule |
|-------|-------|------|
| `sm` | `640px` | 2열 카드 가능 |
| `md` | `768px` | 태블릿 레이아웃, 보조 내비 노출 |
| `lg` | `1024px` | 데스크톱 내비, 상세 2열 시작 |
| `xl` | `1280px` | 최대 콘텐츠 폭 |
| `2xl` | `1536px` | 여백만 증가, 정보 밀도는 유지 |

### Layout Rules

- 홈은 랜딩 페이지보다 검색과 추천 레슨으로 빠르게 진입한다.
- 레슨 상세는 본문과 예약 패널의 2열 구조를 기본으로 한다.
- 예약/결제 화면은 단일 열을 기본으로 하고 요약 패널만 보조로 둔다.
- 지도자/관리자 화면은 카드 남발보다 리스트, 표, 상태 필터를 우선한다.
- 모바일에서 예약 CTA는 하단 고정 바를 사용할 수 있다.
- `h-screen` 대신 `min-height: 100dvh`를 사용한다.

## 5. Components

아래 컴포넌트는 MVP 구현 전부터 고정하는 1차 프리미티브다.

### 5.1 App Shell

구조:

- 공개 영역: 상단 내비게이션, 검색 진입, 로그인/마이페이지, 지도자 등록 CTA
- 로그인 영역: 상단 내비게이션, 사용자 메뉴, 알림 진입
- 지도자 영역: 상단 또는 좌측 관리 내비게이션, 인증 상태 배너
- 관리자 영역: 좌측 내비게이션, 작업 큐, 상세 패널

상태:

- guest
- learner
- coach pending
- coach approved
- admin
- suspended

규칙:

- 데스크톱 내비게이션 높이는 72px 이하로 유지한다.
- 모바일에서는 검색, 예약, 마이페이지 진입을 하단 또는 상단에 명확히 둔다.
- 관리자 화면은 브랜드 마케팅 요소를 줄이고 작업 효율을 우선한다.

### 5.2 Button

Variants:

| Variant | Usage |
|---------|-------|
| Primary | 검색, 예약, 결제, 저장 |
| Secondary | 보조 이동, 수정, 다시 선택 |
| Outline | 정책 보기, 필터 초기화 |
| Ghost | 내비게이션, 표 행 액션 |
| Destructive | 취소, 반려, 신고 처리 |

Structure:

```text
button
  icon optional
  label
  spinner optional
```

Tokens:

- Height: 44px, compact 36px, large 48px
- Radius: 10px
- Padding: `--space-3` `--space-5`
- Primary background: `--accent-primary`
- Primary text: `#ffffff`

States:

- default: 명확한 대비
- hover: `--accent-hover`
- active: `translateY(1px)` 또는 `scale(0.98)`
- focus: 2px ring, `--text-primary`
- disabled: `--surface-inset`, `--text-tertiary`
- loading: 라벨 유지, 작은 progress 표시

Accessibility:

- 텍스트 대비 WCAG AA 이상
- 아이콘만 있는 버튼은 `aria-label` 필수
- destructive 버튼은 의도 확인 모달 또는 2단계 확인 필요

### 5.3 Icon Button

Usage:

- 뒤로 가기
- 공유
- 찜
- 필터 열기
- 이미지 캐러셀 이동

Rules:

- 아이콘은 구현 시 `lucide-react`를 우선 사용한다. 프로젝트가 다른 아이콘 패밀리를 채택하면 이 문서를 먼저 갱신한다.
- 크기: 40px 또는 44px
- Radius: 50%
- 사진 위에 올라갈 경우 흰 배경과 약한 그림자 또는 스크림으로 대비를 보장한다.
- 손으로 SVG path를 작성하지 않는다.

### 5.4 Search Pill

Usage:

- 홈 검색
- 레슨 목록 상단 검색

Structure:

```text
region segment
sport segment
date segment
submit icon button
```

Desktop:

- 둥근 pill 컨테이너
- segment 사이 구분선
- 마지막에 accent 원형 검색 버튼

Mobile:

- 한 줄 검색 pill
- 탭하면 full-screen 또는 bottom sheet 검색 필터를 연다

States:

- no location
- location allowed
- filter active
- loading
- no result

### 5.5 Text Field

Usage:

- 로그인
- 회원가입
- 지도자 인증 신청
- 레슨 등록
- 관리자 메모

Rules:

- label은 항상 input 위에 둔다.
- placeholder를 label 대신 쓰지 않는다.
- helper text와 error text 영역을 미리 확보한다.

Tokens:

- Height: 44px 이상
- Radius: 8px
- Border: `--border-default`
- Focus: `--text-primary` ring
- Error: `--status-error`

현재 구현:

- 모바일은 compact trigger로 native `<dialog>` bottom sheet를 열며, ESC, focus restore, background scroll lock, reduced motion을 보장한다.
- 데스크톱은 지역·종목·일정 3개 segmented pill과 `44px` 이상의 원형 검색 submit을 사용한다.

### 5.6 Select, Combobox, Date Picker

Usage:

- 지역 선택
- 종목 선택
- 일정 선택
- 취소 사유

Rules:

- 선택값이 예약/결제 금액을 바꾸면 즉시 요약 패널에 반영한다.
- 날짜 선택은 이미 마감된 일정과 정원 초과 일정을 disabled로 표시한다.
- 키보드 탐색과 화면 리더 라벨을 보장한다.

### 5.7 Tabs

Usage:

- 레슨 검색 정렬
- 마이페이지 예약 상태
- 지도자 예약 상태
- 관리자 작업 큐

Rules:

- 활성 탭은 두께, 밑줄, 텍스트 색으로 구분한다.
- 탭은 페이지 이동인지 필터인지 역할을 명확히 한다.
- 모바일에서는 가로 스크롤을 허용하되 탭 높이는 44px 이상 유지한다.

### 5.8 Filter Chip

Usage:

- 종목
- 지역
- 가격대
- 요일
- 수업 방식
- 인증 지도자

Variants:

- default
- selected
- removable
- disabled

Rules:

- 선택 상태는 색만으로 구분하지 않고 체크 아이콘 또는 굵기를 함께 사용한다.
- 많은 필터는 drawer 또는 sheet로 보낸다.

### 5.9 Lesson Card

Usage:

- 홈 추천 레슨
- 레슨 검색 결과
- 지도자 레슨 목록 일부

Structure:

```text
photo
  optional favorite button
content
  sport and region
  title
  coach summary
  rating and review count
  schedule summary
  price
```

Visual:

- 사진 비율: 4:3
- 사진 radius: 14px
- 카드 자체에는 강한 그림자를 쓰지 않는다.
- 메타 정보는 4-8px 간격으로 촘촘하게 묶는다.
- 가격은 하단에서 쉽게 스캔되게 한다.

States:

- default
- hover
- focused
- wished
- closed
- loading skeleton
- image missing

Rules:

- 사진 위 텍스트 오버레이를 기본으로 쓰지 않는다.
- 노출되는 레슨은 `active` 상태와 인증 지도자 조건을 만족해야 한다.

### 5.10 Coach Trust Block

Usage:

- 레슨 상세
- 지도자 프로필
- 예약 확인

Content:

- 지도자 이름
- 프로필 사진
- 인증 상태
- 전문 종목
- 경력
- 리뷰 요약
- 신고/문의 진입

Rules:

- 인증 배지는 눈에 띄되 가격 CTA보다 강하지 않게 한다.
- 반려, 심사 중, 정지 상태는 지도자 본인 또는 관리자 화면에서만 상세 노출한다.

### 5.11 Booking Panel

Usage:

- 레슨 상세 우측 예약 패널
- 모바일 하단 예약 바

Structure:

```text
price
schedule selector
capacity
refund summary
primary CTA
policy footnote
```

Desktop:

- 우측 sticky 패널
- 너비 360-400px
- 24px padding
- radius 16px
- border + subtle layered shadow

Mobile:

- 상세 본문 중간에 inline panel
- 주요 CTA는 하단 fixed bar로 반복 가능

States:

- schedule not selected
- available
- low capacity
- full
- pending payment
- expired

Rules:

- 결제 전에는 `예약 확정`이라는 표현을 쓰지 않는다.
- 환불 기준 요약을 CTA 근처에 둔다.
- 가격, 수수료, 총액을 숨기지 않는다.

### 5.12 Price Display

Usage:

- 레슨 카드
- 예약 확인
- 결제
- 정산

Rules:

- 통화 표기는 `원`을 기본으로 한다.
- 할인, 환불, 정산 금액은 원 금액과 상태를 함께 표시한다.
- 결제 화면에서는 총액을 가장 큰 숫자로 둔다.
- 정산 화면에서는 지급 예정, 보류, 완료를 분리한다.

### 5.13 Status Badge

Usage:

- 예약 상태
- 결제 상태
- 환불 상태
- 정산 상태
- 지도자 인증 상태
- 레슨 상태

Badge tokens:

| Status group | Background | Text | Border |
|--------------|------------|------|--------|
| success | `rgba(32, 122, 77, 0.12)` | `--status-success` | `rgba(32, 122, 77, 0.24)` |
| warning | `rgba(181, 106, 0, 0.12)` | `--status-warning` | `rgba(181, 106, 0, 0.24)` |
| error | `rgba(193, 53, 21, 0.12)` | `--status-error` | `rgba(193, 53, 21, 0.24)` |
| info | `rgba(52, 104, 201, 0.12)` | `--status-info` | `rgba(52, 104, 201, 0.24)` |
| neutral | `--surface-inset` | `--text-secondary` | `--border-default` |

Mapping:

| Domain | Status | Badge |
|--------|--------|-------|
| coach_profiles | draft | neutral |
| coach_profiles | submitted | warning |
| coach_profiles | approved | success |
| coach_profiles | rejected | error |
| coach_profiles | suspended | error |
| lessons | draft | neutral |
| lessons | pending_review | warning |
| lessons | active | success |
| lessons | paused | warning |
| lessons | closed | neutral |
| reservations | pending_payment | warning |
| reservations | confirmed | success |
| reservations | completed | success |
| reservations | cancelled_by_user | neutral |
| reservations | cancelled_by_coach | warning |
| reservations | disputed | error |
| payments | ready | warning |
| payments | paid | success |
| payments | failed | error |
| payments | refunded | neutral |
| settlements | pending | warning |
| settlements | paid | success |
| reports | open | error |
| reports | resolved | neutral |

Rules:

- 색상만으로 의미를 전달하지 않는다.
- enum 원문을 그대로 노출하지 않고 한국어 라벨을 사용한다.
- 관리자 표에서는 필터와 동일한 라벨을 사용한다.

### 5.14 Reservation Summary

Usage:

- 예약 확인
- 결제
- 예약 상세
- 관리자 예약 확인

Content:

- 레슨명
- 지도자
- 일정
- 장소
- 인원
- 결제 상태
- 환불 기준
- 신고/문의 진입

Rules:

- 예약 상태별 CTA는 `SPOLINK_화면_설계.md`의 상태별 CTA 표를 따른다.
- 취소 가능 시간과 환불 금액을 함께 표시한다.

### 5.15 Review Card

Usage:

- 레슨 상세
- 마이페이지 리뷰
- 지도자 대시보드

Structure:

- 작성자 표시명
- 평점
- 작성일
- 리뷰 본문
- 신고 버튼

Rules:

- 리뷰가 없으면 평점 영역을 과장하지 않는다.
- 허위 정밀 숫자를 만들지 않는다.
- 신고 버튼은 노출하되 주요 예약 CTA보다 약하게 둔다.

### 5.16 Alert

Variants:

- info
- success
- warning
- error

Usage:

- 결제 실패
- 예약 만료
- 지도자 인증 반려
- 환불 처리 중
- 계정 제한

현재 구현 미디어 경계:

- 카드와 상세는 `photo | missing`을 명시적으로 표현한다. `photo`의 로드 오류는 neutral `missing` 표시로 한 번만 전환한다.
- 공개 찜 추가·삭제 mutation은 보류 상태다. My Page의 기존 찜 read 모델을 보존하되 공개 카드에 비활성 찜 버튼을 남기지 않는다.

Rules:

- Alert는 문제와 다음 행동을 함께 제공한다.
- 결제/예약 오류는 toast만으로 처리하지 않는다.
- 화면에 남아야 하는 상태는 inline alert로 둔다.

### 5.17 Modal and Sheet

Usage:

- 예약 취소 확인
- 환불 규정 보기
- 신고 작성
- 필터
- 모바일 검색

Rules:

- destructive action은 모달로 확인한다.
- 모바일에서는 하단 sheet를 우선한다.
- 포커스 trap, ESC 닫기, 배경 스크롤 잠금을 구현한다.
- 모달 제목은 실제 행동을 설명한다.
- 현재 검색 sheet는 외부 dialog dependency가 아닌 native `<dialog>`를 사용한다. 모바일 bottom sheet와 데스크톱 segmented pill은 같은 검색 URL 계약을 공유한다.

### 5.18 Empty State

Usage:

- 검색 결과 없음
- 예약 없음
- 지도자 레슨 없음
- 정산 없음
- 신고 없음

Structure:

```text
title
short explanation
one primary action
optional secondary action
```

Rules:

- 빈 상태는 사용자를 탓하지 않는다.
- 첫 행동을 제공한다.
- 장식 일러스트를 기본으로 만들지 않는다. 필요하면 실제 종목 사진이나 간결한 아이콘을 사용한다.

### 5.19 Loading State

Patterns:

- 레슨 카드: 사진, 제목, 메타, 가격 형태의 skeleton
- 예약 패널: 가격, 일정, CTA 형태의 skeleton
- 표: 행 skeleton
- 결제: 진행 단계 표시와 중복 클릭 방지

Rules:

- 원형 spinner만 단독으로 두지 않는다.
- 결제 검증 중에는 뒤로 가기와 중복 제출 위험을 줄인다.

### 5.20 Admin Table

Usage:

- 지도자 인증 심사
- 신고 검토
- 예약/결제 확인
- 정산 확인

Structure:

- 상단 필터
- 검색
- 상태 탭
- 표
- 우측 상세 패널 또는 상세 페이지

Rules:

- 표 행 높이는 48px 이상으로 둔다.
- 상태 배지는 작지만 읽을 수 있어야 한다.
- 관리자 작업은 감사 로그 메모와 함께 처리한다.
- 대량 작업은 MVP 범위 밖으로 둔다.

### 5.21 Coach Certification Form

Usage:

- `/coach/apply`, `/coach/apply/status`
- `/admin/coaches`, `/admin/coaches/{coachProfileId}`

Structure:

- 신청자: 계정 요약, 신청 필드, 자격증 목록/업로드, 정산 요약, 저장/제출 액션
- 관리자: 상태 필터 목록, 신청 상세, private 자격증 보기, 승인/반려 액션

Rules:

- PNG/JPEG/PDF, 파일당 10MB 제한과 업로드 실패 이유를 파일 입력 가까이에 표시한다.
- signed upload/read URL의 유효 시간은 300초이며 URL, object name, 원본 bytes를 화면에
  직접 렌더링하지 않는다.
- draft/rejected의 편집 컨트롤과 submitted/approved/suspended의 읽기 전용 상태를 시각적
  상태와 실제 `disabled`/`readOnly` 속성으로 함께 구분한다.
- 로딩, 빈 목록, 검증 실패, 업로드 실패, 반려, 심사 중, 승인, 이용 제한, 권한 없음과
  충돌 상태마다 상태 제목과 다음 행동을 제공한다.
- 1280×800, 768×1024, 390×844에서 44px 이상 터치 타깃, 자연스러운 한국어 줄바꿈,
  키보드 순서와 오류 초점을 유지한다.

## 6. Motion & Interaction

### Timing

| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| Micro | `120ms` | `ease-out` | 버튼 active, chip 선택 |
| Standard | `200ms` | `ease-in-out` | tab 변경, sheet 열림 |
| Emphasis | `320ms` | `cubic-bezier(0.16, 1, 0.3, 1)` | 모달, 페이지 섹션 진입 |

### Rules

- 모션은 상태 변화와 피드백에만 사용한다.
- 무한 반복 장식 모션은 사용하지 않는다.
- `transform`과 `opacity`만 애니메이션한다.
- `prefers-reduced-motion`을 존중한다.
- 결제, 예약, 신고 화면에서는 모션보다 명확한 진행 상태가 우선이다.
- hover가 없는 터치 환경에서도 active/focus 피드백이 있어야 한다.

### Interaction Rules

- Primary CTA active: `scale(0.98)` 또는 `translateY(1px)`
- Card hover: 이미지 확대는 최대 `scale(1.02)`, 텍스트 재배치 금지
- Focus ring: 키보드 사용자를 위해 항상 보이는 링 제공
- Sheet open: 아래에서 위로 200ms
- Modal open: opacity + 작은 scale, 200ms

## 7. Depth & Surface

### Strategy

SPOLINK는 `mixed` 전략을 사용한다.

- 탐색 카드: 사진과 여백 중심, 그림자 없음
- 예약 패널: border + subtle layered shadow
- 관리자 표: border와 tonal shift 중심
- 모달/팝오버: layered shadow

### Border

| Type | Value | Usage |
|------|-------|-------|
| Default | `1px solid var(--border-default)` | 입력창, 패널, 표 |
| Subtle | `1px solid var(--border-subtle)` | 섹션 구분, 리스트 행 |
| Focus | `2px solid var(--text-primary)` | 키보드 포커스 |

### Shadow

| Level | Value | Usage |
|-------|-------|-------|
| none | `none` | 레슨 카드, 기본 리스트 |
| subtle | `0 1px 2px rgba(0, 0, 0, 0.04)` | 작은 popover |
| panel | `0 0 0 1px rgba(0, 0, 0, 0.02), 0 2px 6px rgba(0, 0, 0, 0.04), 0 8px 20px rgba(0, 0, 0, 0.08)` | 예약 패널, 모달 |
| overlay | `0 16px 48px rgba(0, 0, 0, 0.18)` | 중요한 dialog |

### Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-xs` | `4px` | 작은 배지 |
| `--radius-sm` | `8px` | 입력창, 작은 버튼 |
| `--radius-md` | `10px` | 기본 버튼 |
| `--radius-lg` | `14px` | 레슨 사진, 카드 |
| `--radius-xl` | `18px` | 예약 패널, 모달 |
| `--radius-pill` | `999px` | search pill, filter chip |
| `--radius-circle` | `50%` | 아이콘 버튼, 아바타 |

Rules:

- 버튼은 `--radius-md`, 사진은 `--radius-lg`, 패널은 `--radius-xl`을 기본으로 한다.
- 카드 안의 카드 구조를 만들지 않는다.
- 페이지 섹션 전체를 floating card처럼 감싸지 않는다.

## 8. Content And Copy

### Tone

- 안전하고 간결하게 말한다.
- 사용자가 다음 행동을 이해할 수 있게 쓴다.
- 정책성 문구는 과장 없이 명확히 쓴다.
- 지도자와 학습자 모두에게 책임을 전가하는 표현을 피한다.

### Preferred Labels

| Context | Label |
|---------|-------|
| Primary search | `레슨 찾기` |
| Nearby search | `내 주변 레슨 보기` |
| Booking start | `예약하기` |
| Payment | `결제하기` |
| Confirmed reservation | `예약 확정` |
| Refund policy | `환불 기준` |
| Coach apply | `지도자 인증 신청` |
| Review write | `리뷰 작성` |
| Report | `신고하기` |

### Copy Rules

- 버튼 라벨은 1-3단어로 유지한다.
- 결제 전에는 `확정`이라는 단어를 쓰지 않는다.
- 빈 상태는 `아직 예약이 없습니다`처럼 상태를 말하고 다음 행동을 붙인다.
- 오류 문구는 원인과 해결 행동을 함께 말한다.
- 가짜 통계, 가짜 이용자 수, 가짜 평점을 만들지 않는다.

## 9. Accessibility

### Required

- 본문 텍스트 WCAG AA 이상
- 버튼과 필드 터치 영역 44px 이상
- 키보드 포커스 표시
- 모달 focus trap
- 입력 필드 label 연결
- 오류 메시지와 필드 연결
- 색상 외 텍스트/아이콘/형태로 상태 전달
- reduced motion 지원
- reset-password network, abort, non-2xx 실패에서는 이메일 값을 유지하고 retry 가능한 submit을 복구한 뒤 generic alert에 focus한다. signup provider-error는 오류 상태가 반영된 다음 첫 invalid field에 focus한다.

### Korean UI Checks

- 한글 줄바꿈이 버튼 안에서 깨지지 않아야 한다.
- 긴 지역명과 종목명이 카드 폭을 밀어내지 않아야 한다.
- 가격, 날짜, 시간 정보는 모바일에서 줄바꿈 후에도 의미가 유지되어야 한다.
- 관리자 표는 작은 화면에서 가로 스크롤 또는 상세 전환을 명확히 제공한다.

## 10. Implementation Notes

### Current Stack and Deferred Integrations

| Area | Direction |
|------|-----------|
| Framework | Next.js App Router |
| Styling | Tailwind CSS |
| Components | `components/ui`의 project-local primitives와 기능별 컴포넌트, 검색 sheet는 native `<dialog>` |
| Icons | lucide-react, unless the project adopts a different single icon family |
| Motion | CSS transitions first, Motion only when state transition needs it |
| Theme | CSS variables with light and dark values |

로컬 Supabase/Auth/RLS/cancellation 경계만 구현되어 있다. hosted Supabase, actual Toss refund, maps, chat, push, coach upload/submission, public favorite mutation은 deferred이며 완료된 UI나 provider 연동으로 표기하지 않는다.

### Tailwind Mapping

- 색상은 CSS variables로 정의하고 Tailwind theme 또는 utility에서 참조한다.
- 임의 hex를 컴포넌트에 직접 쓰지 않는다.
- spacing은 4px scale을 유지한다.
- radius는 위 CSS variable token을 project-local primitive와 기능별 컴포넌트에서 직접 참조한다.

### Project-local Primitives and Future Library Option

현재 구현은 `components/ui/button.tsx`, `components/ui/status-badge.tsx` 같은 project-local primitive와 기능별 컴포넌트를 사용한다. 모바일 검색 sheet는 외부 dialog component 없이 native `<dialog>`로 focus, ESC, backdrop, scroll lock 경계를 구현한다.

정책 수준의 MVP 목표 방향은 shadcn/ui다. 다만 현재 스캐폴드는 아직 이를 도입하지 않았고, `components/ui`의 project-local primitives와 기능별 컴포넌트, 모바일 검색의 native `<dialog>`를 사용한다. shadcn/ui 도입은 이 문서의 토큰·상태·접근성 계약에 매핑한 뒤 실제 구현에 반영할 때까지 보류한다.

현재 primitive 적용 범위:

- Button: token 기반 radius, color, focus, active state
- Status Badge: 서비스 상태와 semantic color mapping
- Search sheet: native `<dialog>`와 responsive segmented search
- Form fields와 panels: CSS variable token 및 공통 접근성 규칙

## 11. Screen Mapping

| Screen | Primary components |
|--------|--------------------|
| 홈 | App Shell, Search Pill, Lesson Card, Filter Chip |
| 로그인 | Text Field, Button, Alert |
| 회원가입 | Text Field, Checkbox, Button, Alert |
| 온보딩 프로필 | Text Field, Radio Card, Checkbox, Button, Alert |
| 지도자 인증 신청 | Text Field, File Upload, Status Badge, Alert |
| 레슨 검색 | Search Pill, Filter Chip, Lesson Card, Empty State |
| 레슨 상세 | Lesson Card image rules, Coach Trust Block, Booking Panel, Review Card |
| 예약 확인 | Reservation Summary, Price Display, Button, Alert |
| 결제 | Price Display, Reservation Summary, Loading State, Alert |
| 예약 완료 | Status Badge, Reservation Summary, Button |
| 마이페이지 | Status Badge, Reservation Summary, Tabs |
| 리뷰 작성 | Text Field, Rating Input, Button, Alert |
| 지도자 대시보드 | Status Badge, Reservation Summary, Admin Table light |
| 지도자 레슨 관리 | Lesson Card compact, Tabs, Empty State |
| 일정 관리 | Date Picker, Status Badge, Modal |
| 정산 | Price Display, Status Badge, Admin Table light |
| 관리자 홈 | Admin Table, Status Badge, Alert |
| 관리자 인증 심사 | Admin Table, Coach Trust Block, Modal |
| 관리자 신고 검토 | Admin Table, Alert, Modal |
| 관리자 예약/결제 확인 | Admin Table, Reservation Summary, Price Display |

## 12. Pre-Flight Checklist

UI 구현 전:

- `SPOLINK_디자인_시스템.md`를 읽었다.
- 필요한 경우 root `DESIGN.md`가 이 문서를 가리킨다.
- 모든 색상은 Section 2 토큰을 사용한다.
- 모든 폰트 크기는 Section 3 scale을 사용한다.
- 모든 spacing은 4px scale을 사용한다.
- 주요 컴포넌트는 Section 5에 정의되어 있다.
- 상태 배지는 enum과 한국어 라벨 매핑을 갖는다.
- 빈 화면, 로딩, 오류 상태가 구현 범위에 포함되어 있다.
- 모바일, 태블릿, 데스크톱 레이아웃을 각각 확인한다.
- 다크 모드 대비를 확인한다.
- 사진 위 텍스트 오버레이를 기본으로 쓰지 않는다.
- 카드 안에 카드를 중첩하지 않는다.
- 가짜 통계와 가짜 평점을 만들지 않는다.
- 결제/예약 화면에서 서버 검증 전 확정 표현을 쓰지 않는다.

## 13. Open Decisions

구현 직전에 결정하거나 검증할 항목:

- Pretendard self-hosting 방식
- 실제 레슨/지도자 사진 자산 전략
- Naver Maps UI 삽입 시 지도 컨트롤 스타일
- Toss Payments 결제 위젯과 SPOLINK 버튼/패널의 시각 연결 방식
- Supabase Auth 기본 UI를 쓸지, 완전한 커스텀 폼을 쓸지
- 관리자 표에서 TanStack Table을 사용할지 여부

## 14. Next Implementation Step

다음 구현 단계에서 먼저 만들 컴포넌트:

1. CSS variables and theme provider
2. Button
3. Text Field
4. Status Badge
5. Search Pill
6. Lesson Card
7. Booking Panel
8. Reservation Summary
9. Alert
10. Empty and Loading State
