export default function Loading() {
  return (
    <main aria-busy="true" className="min-h-[100dvh]">
      <section className="mx-auto grid w-full max-w-[760px] gap-7 px-4 pb-14 pt-8 md:px-6 md:pt-12">
        <div className="grid gap-3">
          <div className="h-5 w-16 animate-pulse rounded bg-inset" />
          <div className="h-10 w-44 animate-pulse rounded bg-inset" />
          <div className="h-5 w-full max-w-96 animate-pulse rounded bg-inset" />
        </div>
        <div className="grid gap-5 rounded-[var(--radius-xl)] border border-line bg-canvas p-5 md:p-6">
          <div className="h-8 w-28 animate-pulse rounded bg-inset" />
          <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
            <div className="h-12 animate-pulse rounded bg-inset" />
            <div className="h-12 animate-pulse rounded bg-inset" />
            <div className="h-12 animate-pulse rounded bg-inset" />
            <div className="h-12 animate-pulse rounded bg-inset" />
          </div>
        </div>
      </section>
    </main>
  )
}
