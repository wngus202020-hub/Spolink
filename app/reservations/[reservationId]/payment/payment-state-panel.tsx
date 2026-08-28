import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  CreditCard,
  type LucideIcon,
  ShieldCheck,
} from "lucide-react"
import { StatusBadge } from "@/components/ui/status-badge"
import type { PaymentStatePresentation } from "./payment-page-presentation"

const paymentStateIcons = {
  alert: CircleAlert,
  clock: Clock3,
  confirmed: CheckCircle2,
  "credit-card": CreditCard,
  shield: ShieldCheck,
} satisfies Record<PaymentStatePresentation["icon"], LucideIcon>

type PaymentStatePanelProps = Readonly<{
  presentation: PaymentStatePresentation
  role?: "alert" | undefined
}>

export function PaymentStatePanel({ presentation, role }: PaymentStatePanelProps) {
  const Icon = paymentStateIcons[presentation.icon]

  return (
    <section
      className="grid gap-4 rounded-[var(--radius-xl)] border border-line bg-canvas p-5 [box-shadow:var(--shadow-panel)] md:p-6"
      role={role}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Icon aria-hidden="true" className="size-5 text-accent" strokeWidth={1.8} />
        <StatusBadge tone={presentation.tone}>{presentation.badge}</StatusBadge>
      </div>
      <div className="grid gap-3">
        <h1 className="m-0 text-pretty text-[30px] font-bold leading-[1.24] text-primary sm:text-[34px] md:text-5xl">
          {presentation.title}
        </h1>
        <p className="m-0 max-w-[68ch] text-pretty text-base leading-[1.7] text-secondary md:text-lg">
          {presentation.description}
        </p>
      </div>
    </section>
  )
}
