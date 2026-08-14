# SPOLINK 문서 구성 계획

SPOLINK 프로젝트를 효율적으로 개발하고 유지보수하기 위해 아래 10개의 문서를 기준으로 프로젝트를 진행한다.

---

# 1. 서비스 정책서
서비스 운영에 필요한 모든 정책을 정의한다.

## 포함 내용
- 회원 정책
- 지도자 인증 정책
- 예약 및 결제 정책
- 정산 정책
- 환불 정책
- 노쇼 정책
- 리뷰 정책
- 신고 및 차단 정책
- 개인정보 및 위치정보 이용 정책

---

# 2. DB 설계서 (ERD)

서비스에서 사용하는 데이터베이스 구조를 설계한다.

## 주요 테이블
- Users
- Coaches
- Coach Certificates
- Sports
- Lessons
- Lesson Schedules
- Reservations
- Payments
- Settlement
- Reviews
- Chats
- Mate Posts
- Mate Participants
- Activity Records
- Badges
- Notifications

---

# 3. API 명세서

프론트엔드와 백엔드가 사용하는 API를 정의한다.

## 포함 내용
- 인증 API
- 지도자 API
- 레슨 API
- 예약 API
- 결제 API
- 리뷰 API
- 운동 메이트 API
- 운동 기록 API
- 채팅 API
- 알림 API

---

# 4. 전체 화면 설계 (Wireframe)

웹 서비스의 모든 화면을 설계한다.

## 주요 화면
- 메인
- 로그인
- 회원가입
- 지도자 등록
- 지도자 인증
- 레슨 검색
- 레슨 상세
- 예약
- 결제
- 운동 메이트
- 운동 기록
- 마이페이지
- 지도자 대시보드
- 관리자 페이지

---

# 5. UI/UX 디자인 시스템

서비스 전체의 디자인 기준을 정의한다.

## 포함 내용
- 컬러 시스템
- 타이포그래피
- 버튼
- 카드
- 입력창
- 아이콘
- 간격 규칙
- 반응형 기준
- 컴포넌트 규칙

---

# 6. 개발 로드맵

## Phase 1 (MVP)
- 회원가입
- 로그인
- 지도자 인증
- 레슨 등록
- 검색
- 예약
- 결제
- 리뷰
- 채팅
- 마이페이지

## Phase 2
- 운동 메이트
- GPS + QR 출석
- 운동 기록
- 목표 관리
- 배지
- 알림

## Phase 3
- 웹 안정화
- 모바일 앱 개발
- 성능 최적화
- 운영 자동화

---

# 7. 수익 모델(BM)

## 수익 구조
- 레슨 중개 수수료
- 프리미엄 지도자 구독
- 광고
- 이벤트 제휴
- 스포츠 브랜드 제휴

---

# 8. Supabase 기반 시스템 구조

## Supabase Auth
- 회원가입
- 로그인
- 소셜 로그인
- 권한 관리(학습자/지도자/관리자)

## PostgreSQL
- 서비스 데이터 저장

## Storage
- 자격증
- 프로필 사진
- 운동 인증 사진

## Realtime
- 채팅
- 예약 상태 변경
- 실시간 알림 이벤트

## Row Level Security (RLS)
- 사용자별 접근 권한 제어

## Edge Functions
- 결제 검증
- 정산 처리
- 알림 처리

## 외부 서비스 연동
- Toss Payments
- 네이버 지도 API
- Firebase Cloud Messaging(푸시 알림)

---

# 9. 폴더 구조 및 코드 아키텍처

## Frontend
- app/
- components/
- features/
- hooks/
- lib/
- services/
- store/
- types/
- utils/

## Backend(Supabase)
- Database
- Edge Functions
- Storage
- Auth
- Realtime

---

# 10. 출시 로드맵

## Step 1
웹 MVP 개발

## Step 2
베타 테스트

## Step 3
서비스 정식 출시

## Step 4
기능 고도화

## Step 5
모바일 앱(Android / iOS) 출시

---

# 최종 기술 스택

## Frontend
- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Framer Motion

## Backend / BaaS
- Supabase
- PostgreSQL
- Edge Functions
- Realtime
- Storage
- Auth

## 기타
- Toss Payments
- 네이버 지도 API
- Firebase Cloud Messaging
- GitHub
- Figma
- Notion
- Vercel

이 10개의 문서를 기준으로 SPOLINK 프로젝트를 단계적으로 설계, 개발, 테스트 및 출시한다.
