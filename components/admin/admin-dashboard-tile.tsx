import { ArrowRight, type LucideIcon } from "lucide-react"
import Link from "next/link"

type AdminDashboardTileProps = Readonly<{
  action: string
  count: number
  href: string
  icon: LucideIcon
  label: string
}>

export function AdminDashboardTile({
  action,
  count,
  href,
  icon: Icon,
  label,
}: AdminDashboardTileProps) {
  return (
    <li className="min-w-0">
      <Link
        aria-label={`${label} ${count}건, ${action}`}
        className="group grid min-h-44 content-between gap-5 rounded-[var(--radius-lg)] border border-line bg-canvas p-5 hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        href={href}
      >
        <span className="flex items-start justify-between gap-4">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-inset text-primary">
            <Icon aria-hidden="true" className="size-5" strokeWidth={1.8} />
          </span>
          <strong className="text-2xl font-bold leading-tight text-primary">{count}건</strong>
        </span>
        <span className="grid gap-2">
          <strong className="text-base font-bold text-primary">{label}</strong>
          <span className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-secondary group-hover:text-primary">
            {action}
            <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
          </span>
        </span>
      </Link>
    </li>
  )
}
