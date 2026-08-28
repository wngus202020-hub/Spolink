import * as displayLessonMapper from "@/lib/lessons/display-lesson-mapper"
import { createSupabasePublicReadClient } from "@/lib/supabase/public-read-client"

export async function readPublicLessonImages(lessonIds: readonly string[]) {
  const supabase = createSupabasePublicReadClient()

  if (!supabase || lessonIds.length === 0) {
    return displayLessonMapper.success(
      new Map<string, readonly displayLessonMapper.PublicLessonImageRow[]>(),
    )
  }

  const { data, error } = await supabase
    .from("lesson_images")
    .select("*")
    .in("lesson_id", [...lessonIds])
    .eq("lifecycle_state", "ready")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true })

  return error
    ? displayLessonMapper.failure()
    : displayLessonMapper.success(displayLessonMapper.groupByLessonId(data))
}
