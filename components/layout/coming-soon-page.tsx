import { ArrowLeft, CheckCircle2 } from "lucide-react"
import Link from "next/link"

type ComingSoonPageProps = Readonly<{
  eyebrow: string
  title: string
  description: string
  checklist: readonly string[]
}>

export function ComingSoonPage({ checklist, description, eyebrow, title }: ComingSoonPageProps) {
  return (
    <main className="min-h-[100dvh]">
      <div className="mx-auto grid w-full max-w-[920px] gap-8 px-4 py-8 md:px-6 md:py-14">
        <Link
          className="inline-flex w-fit items-center gap-2 rounded-[var(--radius-pill)] px-4 py-2 text-sm font-bold text-secondary hover:bg-inset"
          href="/"
        >
          <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.8} />
          홈으로
        </Link>

        <section className="grid gap-5 rounded-[var(--radius-xl)] border border-line bg-canvas p-6 shadow-[var(--shadow-panel)] md:p-8">
          <span className="text-sm font-bold text-accent">{eyebrow}</span>
          <div className="grid gap-3">
            <h1 className="m-0 text-[30px] font-bold leading-[1.24] text-primary sm:text-[34px] md:text-5xl">
              {title}
            </h1>
            <p className="m-0 max-w-[64ch] text-base leading-[1.7] text-secondary md:text-lg">
              {description}
            </p>
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="m-0 text-xl font-bold text-primary">다음 구현 기준</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {checklist.map((item) => (
              <div
                className="flex min-h-20 items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-canvas p-4"
                key={item}
              >
                <CheckCircle2
                  aria-hidden="true"
                  className="size-5 shrink-0 text-[var(--status-success)]"
                  strokeWidth={1.8}
                />
                <span className="font-bold text-primary">{item}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
