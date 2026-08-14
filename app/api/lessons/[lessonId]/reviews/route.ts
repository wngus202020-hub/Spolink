import { NextResponse } from "next/server"

import { getActiveLessonByIdForDisplay } from "@/lib/lessons/display-lessons"
import { buildLessonReviewsResponse } from "@/lib/lessons/public-lesson-subroute-api"

type LessonReviewsRouteContext = Readonly<{
  params: Promise<{
    lessonId: string
  }>
}>

export async function GET(_request: Request, { params }: LessonReviewsRouteContext) {
  const { lessonId } = await params
  const lesson = await getActiveLessonByIdForDisplay(lessonId)

  if (!lesson) {
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 })
  }

  return NextResponse.json(buildLessonReviewsResponse(lesson))
}
