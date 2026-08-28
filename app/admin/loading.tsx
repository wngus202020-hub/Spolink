const queuePlaceholders = Array.from({ length: 5 }, (_, index) => index)

export default function AdminDashboardLoading() {
  return (
    <main className="min-h-[100dvh]" aria-live="polite">
      <div
        aria-hidden="true"
        className="mx-auto flex min-h-18 w-full max-w-[1280px] items-center justify-between gap-4 px-4 py-4 md:px-6"
      >
        <div className="h-7 w-24 animate-pulse rounded-[var(--radius-md)] bg-inset" />
        <div className="h-11 w-48 animate-pulse rounded-[var(--radius-pill)] bg-inset" />
      </div>
      <section className="mx-auto grid w-full max-w-[1180px] gap-7 px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <div aria-hidden="true" className="grid gap-3 border-b border-line pb-6">
          <div className="h-6 w-24 animate-pulse rounded-[var(--radius-pill)] bg-inset" />
          <div className="h-12 w-full max-w-md animate-pulse rounded-[var(--radius-md)] bg-inset" />
          <div className="h-7 w-full max-w-sm animate-pulse rounded-[var(--radius-md)] bg-inset" />
        </div>
        <p className="sr-only">관리자 운영 현황을 불러오는 중입니다.</p>
        <ul
          aria-hidden="true"
          className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3"
        >
          {queuePlaceholders.map((placeholder) => (
            <li className="min-w-0" key={placeholder}>
              <div className="grid min-h-44 content-between gap-5 rounded-[var(--radius-lg)] border border-line bg-canvas p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="size-10 animate-pulse rounded-[var(--radius-md)] bg-inset" />
                  <div className="h-8 w-16 animate-pulse rounded-[var(--radius-md)] bg-inset" />
                </div>
                <div className="grid gap-2">
                  <div className="h-6 w-28 animate-pulse rounded-[var(--radius-md)] bg-inset" />
                  <div className="h-11 w-32 animate-pulse rounded-[var(--radius-md)] bg-inset" />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
