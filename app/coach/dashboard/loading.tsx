export default function CoachDashboardLoading() {
  return (
    <main
      aria-busy="true"
      className="mx-auto grid min-h-dvh w-full max-w-6xl content-start gap-8 px-4 py-10 md:px-6"
    >
      <p className="m-0 text-sm text-secondary" role="status">
        지도자 운영 현황을 불러오는 중입니다.
      </p>
      <div aria-hidden="true" className="grid gap-4">
        <div className="h-9 w-52 animate-pulse rounded-[var(--radius-md)] bg-inset" />
        <div className="grid gap-px overflow-hidden rounded-[var(--radius-lg)] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {["pending-payment", "confirmed", "completion", "settlement"].map((metric) => (
            <div className="h-28 animate-pulse bg-canvas p-5" key={metric} />
          ))}
        </div>
        <div className="h-56 animate-pulse rounded-[var(--radius-lg)] bg-inset" />
      </div>
    </main>
  )
}
