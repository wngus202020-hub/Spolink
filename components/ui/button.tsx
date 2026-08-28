import type { ButtonHTMLAttributes, ReactNode } from "react"

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost"

type ButtonProps = Readonly<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode
    variant?: ButtonVariant
  }
>

const variantClassNames: Record<ButtonVariant, string> = {
  ghost: "bg-transparent text-primary hover:bg-inset",
  outline: "border border-line bg-canvas text-primary hover:bg-inset",
  primary:
    "bg-accent text-[var(--text-on-accent)] shadow-none hover:bg-[var(--accent-hover)] active:bg-[var(--accent-pressed)]",
  secondary: "bg-primary text-canvas hover:opacity-90",
}

export function buttonClassName(variant: ButtonVariant = "primary", className = ""): string {
  return [
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] px-5 py-3 text-sm font-bold transition-[background-color,opacity,transform] duration-150 ease-out active:translate-y-px",
    variantClassNames[variant],
    className,
  ].join(" ")
}

export function Button({
  children,
  className = "",
  type = "button",
  variant = "primary",
  ...buttonProps
}: ButtonProps) {
  return (
    <button
      className={buttonClassName(variant, `disabled:bg-inset disabled:text-tertiary ${className}`)}
      type={type}
      {...buttonProps}
    >
      {children}
    </button>
  )
}
