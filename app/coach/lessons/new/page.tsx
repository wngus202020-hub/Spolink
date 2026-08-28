import Link from "next/link"

import { PublicHeader } from "@/components/layout/public-header"
import { CoachLessonForm } from "@/components/lessons/coach-lesson-form"
import { readApprovedCoachPage } from "@/lib/lessons/coach-authoring-page"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function NewCoachLessonPage() {
  const { auth, supabase } = await readApprovedCoachPage("/coach/lessons/new")
  const { data: sports, error } = await supabase
    .from("sports")
    .select("id,name")
    .eq("is_active", true)
    .order("name", { ascending: true })
  if (error) throw new CoachLessonPageError("Unable to read sports", { cause: error })

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />
      <section className="mx-auto grid w-full max-w-[880px] gap-8 px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <header className="grid gap-3 border-b border-line pb-6">
          <Link
            className="w-fit text-sm font-bold text-secondary hover:text-primary"
            href="/coach/lessons"
          >
            내 레슨으로
          </Link>
          <h1 className="m-0 text-[34px] font-bold leading-[1.18] text-primary md:text-4xl">
            새 레슨 등록
          </h1>
          <p className="m-0 break-keep text-base leading-7 text-secondary">
            먼저 초안으로 안전하게 저장해요. 저장 후 검토를 요청할 수 있어요.
          </p>
        </header>
        <CoachLessonForm sports={sports ?? []} />
      </section>
    </main>
  )
}

class CoachLessonPageError extends Error {
  readonly name = "CoachLessonPageError"
}
