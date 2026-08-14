import { ArrowRight, BadgeCheck, Compass, UserRoundCheck } from "lucide-react"
import Link from "next/link"

const discoveryLinks = [
  {
    description: "지역과 종목을 살펴보고 나에게 맞는 수업을 찾아보세요.",
    href: "/lessons",
    icon: Compass,
    label: "가까운 레슨 둘러보기",
  },
  {
    description: "경력과 자격을 소개하고 가까운 학습자와 만나보세요.",
    href: "/coach/apply",
    icon: UserRoundCheck,
    label: "지도자로 함께하기",
  },
] as const

export function HomeDiscoveryPanel() {
  return (
    <aside aria-labelledby="home-discovery-title" className="grid gap-[var(--space-6)]">
      <div className="grid gap-[var(--space-2)]">
        <span className="inline-flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent">
          <BadgeCheck aria-hidden="true" className="size-5" strokeWidth={2} />
        </span>
        <h2
          className="m-0 text-[length:var(--type-h2-size)] font-bold leading-[var(--type-h2-leading)] text-primary"
          id="home-discovery-title"
        >
          믿고 시작하는 가까운 운동
        </h2>
        <p className="m-0 text-sm leading-6 text-secondary">
          지도자 정보와 수업 일정을 먼저 살펴보고, 준비가 되면 다음 단계로 이동하세요.
        </p>
      </div>

      <div className="divide-y divide-line-subtle border-y border-line-subtle">
        {discoveryLinks.map((item) => {
          const Icon = item.icon

          return (
            <Link
              className="group grid min-h-24 grid-cols-[auto_1fr_auto] items-center gap-[var(--space-3)] py-[var(--space-4)] text-primary transition-colors hover:text-accent"
              href={item.href}
              key={item.href}
            >
              <Icon aria-hidden="true" className="size-5 text-secondary" strokeWidth={1.8} />
              <span className="grid gap-1">
                <strong className="text-lg leading-snug">{item.label}</strong>
                <span className="text-sm leading-6 text-secondary">{item.description}</span>
              </span>
              <ArrowRight
                aria-hidden="true"
                className="size-5 text-secondary transition-transform group-hover:translate-x-1"
                strokeWidth={1.8}
              />
            </Link>
          )
        })}
      </div>

      <p className="m-0 text-sm leading-6 text-secondary">
        인증 상태와 수업 정보를 투명하게 확인할 수 있어요.
      </p>
    </aside>
  )
}
