"use client"

export default function ProfileEditError({ reset }: Readonly<{ reset: () => void }>) {
  return (
    <main className="min-h-[100dvh]">
      <section className="mx-auto grid w-full max-w-[760px] gap-3 px-4 py-12 md:px-6" role="alert">
        <h1 className="m-0 text-2xl font-bold text-primary">프로필 정보를 불러오지 못했어요</h1>
        <p className="m-0 text-secondary">잠시 후 다시 시도해 주세요.</p>
        <button
          className="w-fit rounded-[var(--radius-md)] border border-line px-4 py-3 text-sm font-bold text-primary"
          onClick={reset}
          type="button"
        >
          다시 시도
        </button>
      </section>
    </main>
  )
}
