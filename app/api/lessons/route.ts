import { type NextRequest, NextResponse } from "next/server"

import { lessonAuthoringRouteDependencies } from "@/lib/lessons/authoring-default-dependencies"
import { createCreateLessonRouteHandler } from "@/lib/lessons/authoring-route-handlers"
import { getFeaturedLessonsForDisplay } from "@/lib/lessons/display-lessons"
import { buildLessonListResponse, parseLessonListQuery } from "@/lib/lessons/public-lesson-api"

export async function GET(request: NextRequest) {
  const parsedQuery = parseLessonListQuery(request.nextUrl.searchParams)

  if (parsedQuery.status === "failure") {
    return NextResponse.json(
      { error: "Invalid lesson search query", issues: parsedQuery.issues },
      { status: 400 },
    )
  }

  const lessons = await getFeaturedLessonsForDisplay()

  return NextResponse.json(buildLessonListResponse(lessons, parsedQuery.query))
}

export const POST = createCreateLessonRouteHandler(lessonAuthoringRouteDependencies)
