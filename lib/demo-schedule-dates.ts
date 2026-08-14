const millisecondsPerDay = 24 * 60 * 60 * 1000
const initializedAt = new Date()
const initializedStartOfDayUtc = Date.UTC(
  initializedAt.getUTCFullYear(),
  initializedAt.getUTCMonth(),
  initializedAt.getUTCDate(),
)

type UtcClockTime = Readonly<{
  hour: number
  minute?: number
}>

export function futureDemoStartsAt(daysFromToday: number, time: UtcClockTime) {
  const minute = time.minute ?? 0

  return new Date(
    initializedStartOfDayUtc +
      daysFromToday * millisecondsPerDay +
      time.hour * 60 * 60 * 1000 +
      minute * 60 * 1000,
  ).toISOString()
}
