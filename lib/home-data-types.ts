export type LessonStatus = "active" | "pending_review" | "closed"

export type LessonSchedule = Readonly<{
  id: string
  label: string
  capacityText: string
  capacity?: number
  isOpen?: boolean
  remainingCount?: number
  reservedCount?: number
  startsAt?: string
}>

export type LessonReview = Readonly<{
  content: string | null
  createdAt: string
  id: string
  rating: number
}>

export type LessonMedia = Readonly<
  | {
      images?: readonly LessonMediaImage[]
      kind: "photo"
      src: string
    }
  | {
      kind: "missing"
    }
>

export type LessonMediaImage = Readonly<{
  sortOrder: number
  url: string
}>

export type Lesson = Readonly<{
  id: string
  title: string
  sportId: string
  sport: string
  region: string
  coachId: string
  coachName: string
  summary: string
  priceAmount: number
  priceText: string
  durationMinutes: number
  scheduleText: string
  durationText: string
  venueText: string
  preparationText: string
  refundSummary: string
  coachProfileText: string
  coachExperienceText: string
  ratingAverage: number | null
  ratingText: string
  capacityText: string
  reviewSummary: string
  reviews: readonly LessonReview[]
  detailBullets: readonly string[]
  schedules: readonly LessonSchedule[]
  status: LessonStatus
  media: LessonMedia
}>

export type TrustMetric = Readonly<{
  label: string
  value: string
}>
