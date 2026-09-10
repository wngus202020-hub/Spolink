import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react"

type TextInputProps = Readonly<InputHTMLAttributes<HTMLInputElement>>
type SelectInputProps = Readonly<SelectHTMLAttributes<HTMLSelectElement>>
type TextareaInputProps = Readonly<TextareaHTMLAttributes<HTMLTextAreaElement>>

function controlClassName(modifier: string, className: string | undefined): string {
  return ["form-control", modifier, className].filter(Boolean).join(" ")
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className, ...props },
  ref,
) {
  return <input className={controlClassName("", className)} ref={ref} {...props} />
})

export const SelectInput = forwardRef<HTMLSelectElement, SelectInputProps>(function SelectInput(
  { className, ...props },
  ref,
) {
  return <select className={controlClassName("", className)} ref={ref} {...props} />
})

export const TextareaInput = forwardRef<HTMLTextAreaElement, TextareaInputProps>(
  function TextareaInput({ className, ...props }, ref) {
    return (
      <textarea
        className={controlClassName("form-control--textarea", className)}
        ref={ref}
        {...props}
      />
    )
  },
)
