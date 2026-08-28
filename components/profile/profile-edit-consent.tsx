import type { ChangeEvent, ReactNode } from "react"

export function ProfileEditConsent({
  checked,
  children,
  disabled,
  name,
  onChange,
}: Readonly<{
  checked: boolean
  children: ReactNode
  disabled: boolean
  name: "locationAgreed" | "marketingAgreed"
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}>) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3">
      <input
        checked={checked}
        className="mt-0.5 size-5 accent-[var(--accent-primary)]"
        disabled={disabled}
        name={name}
        onChange={onChange}
        type="checkbox"
      />
      <span>{children}</span>
    </label>
  )
}
