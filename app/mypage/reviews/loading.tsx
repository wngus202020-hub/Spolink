export default function Loading() {
  return (
    <main aria-busy="true" className="min-h-[100dvh]">
      <section className="mx-auto grid w-full max-w-[1120px] gap-6 px-4 pb-14 pt-6 md:px-6 md:pt-10">
        <h1 className="sr-only">내 리뷰</h1>
        <div className="h-10 w-32 animate-pulse rounded bg-inset" />
        <div className="grid gap-3">
          <div className="h-7 w-24 animate-pulse rounded bg-inset" />
          <div className="h-12 w-44 animate-pulse rounded bg-inset" />
          <div className="h-6 w-full max-w-96 animate-pulse rounded bg-inset" />
        </div>
        <div className="grid gap-5 border-y border-line py-5">
          <div className="h-7 w-36 animate-pulse rounded bg-inset" />
          <div className="h-32 animate-pulse rounded bg-inset" />
          <div className="h-32 animate-pulse rounded bg-inset" />
        </div>
      </section>
    </main>
  )
}
