import Link from "next/link"
import type { PageAuthProfile } from "@/lib/auth/page-auth"

const navigationItems = [
  { href: "/lessons", label: "레슨" },
  { href: "/coach/apply", label: "지도자 등록" },
] as const

type PublicHeaderProps = Readonly<{
  auth: PageAuthProfile
}>

export function PublicHeader({ auth }: PublicHeaderProps) {
  return (
    <header className="mx-auto flex min-h-18 w-full max-w-[1280px] flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-6">
      <Link className="text-xl font-bold tracking-normal text-primary" href="/">
        SPOLINK
      </Link>
      <nav
        aria-label="주요 메뉴"
        className="order-3 flex min-w-0 w-full flex-wrap items-center gap-1 overflow-visible text-xs text-secondary sm:order-none sm:w-auto sm:gap-2 sm:text-sm"
      >
        {navigationItems.map((item) => (
          <Link
            className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-[var(--radius-pill)] px-3 py-2 hover:bg-inset sm:px-4"
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        ))}
        <HeaderAccountAction auth={auth} />
      </nav>
    </header>
  )
}

function HeaderAccountAction({ auth }: PublicHeaderProps) {
  if (auth.kind === "profile_required") {
    return (
      <Link
        className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-[var(--radius-pill)] bg-primary px-3 py-2 font-bold text-canvas sm:px-4"
        href="/onboarding/profile"
      >
        프로필 설정
      </Link>
    )
  }

  if (auth.kind === "ready") {
    return (
      <div className="flex min-w-0 basis-full flex-wrap items-center justify-end gap-2 sm:basis-auto">
        <span className="min-w-0 max-w-32 whitespace-normal break-words text-right text-sm font-bold leading-normal text-primary sm:max-w-48">
          {auth.profile.display_name}
        </span>
        <Link
          className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-[var(--radius-pill)] bg-inset px-3 py-2 font-bold text-primary hover:bg-accent-soft sm:px-4"
          href="/mypage"
        >
          마이
        </Link>
        <form action="/auth/logout" method="post">
          <button
            className="min-h-11 shrink-0 whitespace-nowrap rounded-[var(--radius-pill)] px-3 py-2 font-bold text-secondary hover:bg-inset sm:px-4"
            type="submit"
          >
            로그아웃
          </button>
        </form>
      </div>
    )
  }

  return (
    <Link
      className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-[var(--radius-pill)] px-3 py-2 hover:bg-inset sm:px-4"
      href="/auth/login"
    >
      로그인
    </Link>
  )
}
