import type { LessonLocation } from "../home-data-types"

type LessonWithLocation = Readonly<{
  id: string
  location: LessonLocation | null
  region: string
  title: string
  venueText: string
}>

export type MappableLesson<LessonType extends LessonWithLocation = LessonWithLocation> =
  LessonType & Readonly<{ location: LessonLocation }>

export function selectMappableLessons<LessonType extends LessonWithLocation>(
  lessons: readonly LessonType[],
): readonly MappableLesson<LessonType>[] {
  return lessons.filter(hasMappableLocation)
}

function hasMappableLocation<LessonType extends LessonWithLocation>(
  lesson: LessonType,
): lesson is MappableLesson<LessonType> {
  const location = lesson.location
  return (
    location !== null &&
    Number.isFinite(location.latitude) &&
    Number.isFinite(location.longitude) &&
    location.latitude >= -90 &&
    location.latitude <= 90 &&
    location.longitude >= -180 &&
    location.longitude <= 180
  )
}
