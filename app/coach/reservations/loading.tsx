export default function Loading() {
  return (
    <main className="mx-auto grid max-w-[1120px] gap-6 px-4 py-12" aria-busy="true">
      <div className="h-10 w-48 animate-pulse rounded bg-inset" />
      <div className="h-28 animate-pulse rounded-[var(--radius-lg)] bg-inset" />
    </main>
  )
}
