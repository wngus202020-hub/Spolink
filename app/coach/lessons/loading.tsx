export default function CoachLessonsLoading() {
  return (
    <main
      aria-busy="true"
      className="mx-auto min-h-[100dvh] w-full max-w-[1120px] px-4 py-12 md:px-6"
    >
      <p className="m-0 text-sm font-bold text-secondary">레슨 관리 화면을 불러오고 있어요.</p>
      <div className="mt-6 grid gap-4" role="status">
        {["first", "second", "third"].map((key) => (
          <div className="h-28 animate-pulse rounded-[var(--radius-lg)] bg-inset" key={key} />
        ))}
      </div>
    </main>
  )
}
