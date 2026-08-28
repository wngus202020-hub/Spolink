export default function Loading() {
  return (
    <main aria-busy="true" className="mx-auto grid max-w-[760px] gap-5 px-4 py-12">
      <div className="h-10 w-48 animate-pulse rounded bg-inset" />
      <div className="h-56 animate-pulse rounded-[var(--radius-lg)] bg-inset" />
    </main>
  )
}
