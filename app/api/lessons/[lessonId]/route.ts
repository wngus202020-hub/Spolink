import { NextResponse } from "next/server"

import { lessonAuthoringRouteDependencies } from "@/lib/lessons/authoring-default-dependencies"
import { createUpdateLessonRouteHandler } from "@/lib/lessons/authoring-route-handlers"
import { getActiveLessonByIdForDisplay } from "@/lib/lessons/display-lessons"
import { buildLessonDetailResponse } from "@/lib/lessons/public-lesson-api"

type LessonDetailRouteContext = Readonly<{
  params: Promise<{
    lessonId: string
  }>
}>

export async function GET(_request: Request, { params }: LessonDetailRouteContext) {
  const { lessonId } = await params
  const lesson = await getActiveLessonByIdForDisplay(lessonId)

  if (!lesson) {
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 })
  }

  return NextResponse.json(buildLessonDetailResponse(lesson))
}

export const PATCH = createUpdateLessonRouteHandler(lessonAuthoringRouteDependencies)
