import type { LucideIcon } from "lucide-react"
import { Activity } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

type AuthShellProps = Readonly<{
  children: ReactNode
  description: string
  eyebrow: string
  icon?: LucideIcon
  title: ReactNode
}>

export function AuthShell({
  children,
  description,
  eyebrow,
  icon: Icon = Activity,
  title,
}: AuthShellProps) {
  return (
    <main className="min-h-[100dvh] bg-canvas px-4 py-8 text-primary sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100dvh-64px)] w-full max-w-[1120px] items-center justify-center">
        <section className="grid w-full gap-8 lg:grid-cols-[minmax(0,0.82fr)_minmax(360px,440px)] lg:items-center">
          <div className="space-y-6">
            <Link
              className="inline-flex items-center gap-3 text-base font-bold text-primary"
              href="/"
            >
              <span className="grid size-10 place-items-center rounded-[var(--radius-md)] bg-accent text-white">
                <Activity aria-hidden="true" className="size-5" />
              </span>
              SPOLINK
            </Link>
            <div className="max-w-[560px] space-y-4">
              <p className="text-sm font-bold text-secondary">{eyebrow}</p>
              <h1 className="text-4xl font-bold leading-tight tracking-normal text-primary sm:text-5xl">
                {title}
              </h1>
              <p className="text-lg leading-relaxed text-secondary">{description}</p>
            </div>
            <aside
              aria-label="SPOLINK 계정 안내"
              className="max-w-[560px] rounded-[var(--radius-lg)] border border-line bg-inset p-5 shadow-[var(--shadow-panel)]"
            >
              <ul className="space-y-3 text-sm leading-relaxed text-secondary">
                <li className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-accent"
                  />
                  <span>이메일로 계정을 확인해요</span>
                </li>
                <li className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-accent"
                  />
                  <span>프로필은 확인 뒤 입력해요</span>
                </li>
                <li className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-accent"
                  />
                  <span>예약과 지도자 상태를 투명하게 보여드려요</span>
                </li>
              </ul>
            </aside>
          </div>
          <div className="rounded-[var(--radius-lg)] border border-line bg-elevated p-6 shadow-[var(--shadow-panel)] sm:p-8">
            <div className="mb-6 grid size-12 place-items-center rounded-[var(--radius-md)] bg-accent-soft text-accent">
              <Icon aria-hidden="true" className="size-6" />
            </div>
            {children}
          </div>
        </section>
      </div>
    </main>
  )
}
