import { Search, X } from "lucide-react"
import { useId } from "react"
import { TextInput } from "@/components/ui/form-controls"

type SearchableChoiceInputProps = Readonly<{
  label: string
  onChange: (value: string) => void
  placeholder: string
  resultCount: number
  value: string
}>

export function SearchableChoiceInput({
  label,
  onChange,
  placeholder,
  resultCount,
  value,
}: SearchableChoiceInputProps) {
  const inputId = useId()
  const statusId = useId()

  return (
    <label className="relative block" htmlFor={inputId}>
      <span className="sr-only">{label}</span>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-secondary"
        strokeWidth={1.8}
      />
      <TextInput
        aria-describedby={statusId}
        autoComplete="off"
        className="form-control--search"
        enterKeyHint="search"
        id={inputId}
        inputMode="search"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault()
        }}
        placeholder={placeholder}
        type="text"
        value={value}
      />
      {value ? (
        <button
          aria-label={`${label} 지우기`}
          className="absolute right-1 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-secondary hover:bg-canvas hover:text-primary"
          onClick={() => onChange("")}
          title={`${label} 지우기`}
          type="button"
        >
          <X aria-hidden="true" className="size-4" strokeWidth={2} />
        </button>
      ) : null}
      <span aria-live="polite" className="sr-only" id={statusId}>
        일치하는 선택지 {resultCount}개
      </span>
    </label>
  )
}
