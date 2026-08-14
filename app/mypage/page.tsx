import {
  ArrowRight,
  CalendarDays,
  Heart,
  MapPin,
  MessageSquare,
  ShieldCheck,
  UserRound,
  UserRoundCog,
} from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PublicHeader } from "@/components/layout/public-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { readPageAuthProfile } from "@/lib/auth/page-auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

const roleLabels = {
  admin: "관리자",
  coach: "지도자",
  learner: "학습자",
} as const

export default async function MyPage() {
  const auth = await readPageAuthProfile()
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured") {
    redirect("/auth/login?next=/mypage")
  }
  if (auth.kind === "profile_required") {
    redirect("/onboarding/profile")
  }

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />

      <section className="mx-auto grid w-full max-w-[1080px] gap-8 px-4 pb-14 pt-8 md:px-6 md:pt-12">
        <div className="grid gap-3">
          <StatusBadge tone="success">내 프로필</StatusBadge>
          <h1 className="m-0 text-[34px] font-bold leading-[1.18] text-primary md:text-5xl md:leading-[1.14]">
            마이페이지
          </h1>
          <p className="m-0 max-w-[62ch] text-base leading-[1.7] text-secondary md:text-lg">
            내 정보, 예약, 찜한 레슨과 리뷰 활동을 한곳에서 확인해요.
          </p>
        </div>

        <section className="grid gap-5 rounded-[var(--radius-xl)] border border-line bg-canvas p-5 [box-shadow:var(--shadow-panel)] md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-3">
              <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-inset text-primary">
                <UserRound aria-hidden="true" className="size-6" strokeWidth={1.8} />
              </span>
              <div className="grid gap-1">
                <span className="text-sm text-secondary">프로필</span>
                <h2 className="m-0 text-[24px] font-bold leading-[1.3] text-primary">
                  {auth.profile.display_name}
                </h2>
              </div>
            </div>
            <StatusBadge tone="neutral">{roleLabels[auth.profile.role]}</StatusBadge>
          </div>

          <dl className="m-0 grid gap-3 border-t border-line pt-5 sm:grid-cols-2">
            <div className="grid gap-1">
              <dt className="text-sm font-bold text-primary">계정 상태</dt>
              <dd className="m-0 text-sm text-secondary">이용 가능</dd>
            </div>
            <div className="grid gap-1">
              <dt className="inline-flex items-center gap-2 text-sm font-bold text-primary">
                <MapPin aria-hidden="true" className="size-4 text-accent" strokeWidth={1.8} />
                기본 지역
              </dt>
              <dd className="m-0 text-sm text-secondary">
                {auth.profile.default_region ?? "설정된 지역 없음"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="grid gap-4">
          <div className="grid gap-1">
            <h2 className="m-0 text-[26px] font-bold leading-[1.32] text-primary">활동 관리</h2>
            <p className="m-0 text-sm leading-[1.6] text-secondary">
              필요한 메뉴를 선택해 나의 스포츠 활동을 관리해요.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <article className="grid min-h-48 content-between gap-5 rounded-[var(--radius-xl)] border border-line bg-subtle p-5 md:p-6">
              <div className="flex items-start justify-between gap-4">
                <span className="inline-flex size-12 items-center justify-center rounded-[var(--radius-lg)] bg-inset text-primary">
                  <UserRoundCog aria-hidden="true" className="size-6" strokeWidth={1.8} />
                </span>
                <StatusBadge tone="neutral">준비중</StatusBadge>
              </div>
              <div className="grid gap-1">
                <h3 className="m-0 text-[22px] font-bold leading-[1.36] text-primary">내 정보</h3>
                <p className="m-0 text-sm leading-[1.6] text-secondary">
                  표시 이름과 기본 지역을 확인하고 관리해요.
                </p>
              </div>
            </article>

            <Link
              aria-label="내 예약 관리로 이동"
              className="group grid min-h-48 content-between gap-5 rounded-[var(--radius-xl)] border border-line bg-canvas p-5 hover:bg-subtle md:p-6"
              href="/mypage/reservations"
            >
              <span className="inline-flex size-12 items-center justify-center rounded-[var(--radius-lg)] bg-accent-soft text-primary">
                <CalendarDays aria-hidden="true" className="size-6" strokeWidth={1.8} />
              </span>
              <span className="grid gap-3">
                <span className="grid gap-1">
                  <strong className="text-[22px] font-bold leading-[1.36] text-primary">
                    내 예약
                  </strong>
                  <span className="text-sm leading-[1.6] text-secondary">
                    예약 상태, 결제와 환불 요약을 확인해요.
                  </span>
                </span>
                <span className="inline-flex min-h-11 w-fit items-center gap-2 text-sm font-bold text-primary">
                  예약 보기
                  <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
                </span>
              </span>
            </Link>

            <Link
              aria-label="찜한 레슨 목록으로 이동"
              className="group grid min-h-48 content-between gap-5 rounded-[var(--radius-xl)] border border-line bg-canvas p-5 hover:bg-subtle md:p-6"
              href="/mypage/favorites"
            >
              <span className="inline-flex size-12 items-center justify-center rounded-[var(--radius-lg)] bg-accent-soft text-primary">
                <Heart aria-hidden="true" className="size-6" strokeWidth={1.8} />
              </span>
              <span className="grid gap-3">
                <span className="grid gap-1">
                  <strong className="text-[22px] font-bold leading-[1.36] text-primary">
                    찜한 레슨
                  </strong>
                  <span className="text-sm leading-[1.6] text-secondary">
                    관심 있는 레슨을 모아 다시 살펴봐요.
                  </span>
                </span>
                <span className="inline-flex min-h-11 w-fit items-center gap-2 text-sm font-bold text-primary">
                  찜 목록 보기
                  <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
                </span>
              </span>
            </Link>

            <article className="grid min-h-48 content-between gap-5 rounded-[var(--radius-xl)] border border-line bg-subtle p-5 md:p-6">
              <div className="flex items-start justify-between gap-4">
                <span className="inline-flex size-12 items-center justify-center rounded-[var(--radius-lg)] bg-inset text-primary">
                  <MessageSquare aria-hidden="true" className="size-6" strokeWidth={1.8} />
                </span>
                <StatusBadge tone="neutral">준비중</StatusBadge>
              </div>
              <div className="grid gap-1">
                <h3 className="m-0 text-[22px] font-bold leading-[1.36] text-primary">리뷰 관리</h3>
                <p className="m-0 text-sm leading-[1.6] text-secondary">
                  참여한 레슨의 리뷰 작성과 내역 관리를 준비하고 있어요.
                </p>
              </div>
            </article>

            <Link
              aria-label="지도자 등록 안내로 이동"
              className="group grid min-h-48 content-between gap-5 rounded-[var(--radius-xl)] border border-line bg-canvas p-5 hover:bg-subtle md:col-span-2 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center md:p-6"
              href="/coach/apply"
            >
              <span className="inline-flex size-12 items-center justify-center rounded-[var(--radius-lg)] bg-inset text-primary">
                <ShieldCheck aria-hidden="true" className="size-6" strokeWidth={1.8} />
              </span>
              <span className="grid gap-1">
                <strong className="text-[22px] font-bold leading-[1.36] text-primary">
                  지도자 등록
                </strong>
                <span className="text-sm leading-[1.6] text-secondary">
                  자격과 경력을 인증하고 지도자 활동을 준비해요.
                </span>
              </span>
              <span className="inline-flex min-h-11 w-fit items-center gap-2 text-sm font-bold text-primary">
                등록 안내
                <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
              </span>
            </Link>
          </div>
        </section>
      </section>
    </main>
  )
}
