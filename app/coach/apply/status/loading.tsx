import { LoaderCircle } from "lucide-react"

export default function CoachApplicationStatusLoading() {
  return (
    <main className="grid min-h-[100dvh] place-items-center px-4">
      <p
        aria-live="polite"
        className="flex items-center gap-3 text-sm text-secondary"
        role="status"
      >
        <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
        신청 상태를 불러오고 있어요.
      </p>
    </main>
  )
}
