import { NextResponse } from "next/server"

import { lessonAuthoringRouteDependencies } from "@/lib/lessons/authoring-default-dependencies"
import { createCreateScheduleRouteHandler } from "@/lib/lessons/authoring-route-handlers"
import { getActiveLessonByIdForDisplay } from "@/lib/lessons/display-lessons"
import {
  buildLessonSchedulesResponse,
  parseLessonSchedulesQuery,
} from "@/lib/lessons/public-lesson-subroute-api"

type LessonSchedulesRouteContext = Readonly<{
  params: Promise<{
    lessonId: string
  }>
}>

export async function GET(request: Request, { params }: LessonSchedulesRouteContext) {
  const parsedQuery = parseLessonSchedulesQuery(new URL(request.url).searchParams)

  if (parsedQuery.status === "failure") {
    return NextResponse.json(
      { error: "Invalid lesson schedules query", issues: parsedQuery.issues },
      { status: 400 },
    )
  }

  const { lessonId } = await params
  const lesson = await getActiveLessonByIdForDisplay(lessonId, { scheduleQuery: parsedQuery.query })

  if (!lesson) {
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 })
  }

  return NextResponse.json(buildLessonSchedulesResponse(lesson, parsedQuery.query))
}

export const POST = createCreateScheduleRouteHandler(lessonAuthoringRouteDependencies)
