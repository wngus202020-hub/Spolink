import type { InputHTMLAttributes, ReactNode, RefObject } from "react"
import { TextInput } from "@/components/ui/form-controls"

type AuthTextFieldProps = Readonly<
  Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
    error?: string | undefined
    helperText?: string | undefined
    inputRef?: RefObject<HTMLInputElement | null> | undefined
    label: string
  }
>

type AuthAlertProps = Readonly<{
  alertRef?: RefObject<HTMLDivElement | null> | undefined
  children: ReactNode
  tabIndex?: number | undefined
  tone?: "error" | "info" | "success"
}>

const alertToneClassNames: Record<NonNullable<AuthAlertProps["tone"]>, string> = {
  error: "border-[color:var(--status-error)] bg-inset text-primary",
  info: "border-line bg-inset text-secondary",
  success: "border-[color:var(--status-success)] bg-inset text-primary",
}

export function AuthTextField({
  error,
  helperText = " ",
  id,
  inputRef,
  label,
  type = "text",
  ...inputProps
}: AuthTextFieldProps) {
  const messageId = `${id}-message`

  return (
    <div className="grid min-w-0 gap-2">
      <label className="text-sm font-bold text-primary" htmlFor={id}>
        {label}
      </label>
      <TextInput
        aria-describedby={messageId}
        aria-invalid={error ? true : undefined}
        id={id}
        ref={inputRef}
        type={type}
        {...inputProps}
      />
      <p
        className={[
          "min-h-5 text-sm",
          error ? "text-[color:var(--status-error)]" : "text-secondary",
        ].join(" ")}
        id={messageId}
      >
        {error ?? helperText}
      </p>
    </div>
  )
}

export function AuthAlert({ alertRef, children, tabIndex, tone = "info" }: AuthAlertProps) {
  return (
    <div
      className={[
        "rounded-[var(--radius-md)] border px-4 py-3 text-sm leading-normal",
        alertToneClassNames[tone],
      ].join(" ")}
      ref={alertRef}
      role={tone === "error" ? "alert" : "status"}
      tabIndex={tabIndex}
    >
      {children}
    </div>
  )
}
