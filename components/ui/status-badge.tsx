type BadgeTone = "error" | "success" | "warning" | "neutral"

type StatusBadgeProps = Readonly<{
  children: string
  tone: BadgeTone
}>

const toneClassNames: Record<BadgeTone, string> = {
  error:
    "border-[color-mix(in_srgb,var(--status-error)_24%,transparent)] bg-[color-mix(in_srgb,var(--status-error)_12%,transparent)] text-[var(--status-error)]",
  neutral: "border-line bg-inset text-secondary",
  success:
    "border-[color-mix(in_srgb,var(--status-success)_24%,transparent)] bg-[color-mix(in_srgb,var(--status-success)_12%,transparent)] text-[var(--status-success)]",
  warning:
    "border-[color-mix(in_srgb,var(--status-warning)_24%,transparent)] bg-[color-mix(in_srgb,var(--status-warning)_12%,transparent)] text-[var(--status-warning)]",
}

export function StatusBadge({ children, tone }: StatusBadgeProps) {
  return (
    <span
      className={[
        "inline-flex min-h-7 w-fit items-center rounded-[var(--radius-pill)] border px-3 text-xs font-bold",
        toneClassNames[tone],
      ].join(" ")}
    >
      {children}
    </span>
  )
}
