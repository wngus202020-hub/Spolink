import { createElement } from "react"

class RouteSignal extends Error {
  constructor(kind, destination) {
    super(`${kind}:${destination ?? ""}`)
    this.destination = destination
    this.kind = kind
  }
}

const runtime = {
  auth: null,
  bookingResult: null,
  bookingCalls: [],
  lessons: [],
  routerPushes: [],
  stateUpdates: [],
}

export default function Link({ children, href, ...props }) {
  return createElement("a", { ...props, href }, children)
}

export function Button({ children, ...props }) {
  return createElement("button", { type: "button", ...props }, children)
}

export function PublicHeader({ auth }) {
  return createElement("header", { "data-auth-kind": auth.kind }, "SPOLINK")
}

export function StatusBadge({ children, tone }) {
  return createElement("span", { "data-tone": tone }, children)
}

export async function createBookingReservation(request) {
  runtime.bookingCalls.push(request)
  return runtime.bookingResult
}

export async function getActiveLessonByIdForDisplay(lessonId) {
  return runtime.lessons.find((lesson) => lesson.id === lessonId) ?? null
}

export async function getActiveLessonsForDisplay() {
  return runtime.lessons
}

export function notFound() {
  throw new RouteSignal("not-found", null)
}

export function redirect(destination) {
  throw new RouteSignal("redirect", destination)
}

export async function readPageAuthProfile() {
  return runtime.auth
}

export function useEffect() {}

export function useRef(initialValue) {
  return { current: initialValue }
}

export function useRouter() {
  return { push: (path) => runtime.routerPushes.push(path) }
}

export function useState(initialValue) {
  return [initialValue, (value) => runtime.stateUpdates.push(value)]
}

export function configureBookingRuntime({ auth, bookingResult, lessons }) {
  runtime.auth = auth
  runtime.bookingResult = bookingResult
  runtime.lessons = lessons
  runtime.bookingCalls = []
  runtime.routerPushes = []
  runtime.stateUpdates = []
}

export function readBookingRuntimeEvents() {
  return {
    bookingCalls: [...runtime.bookingCalls],
    routerPushes: [...runtime.routerPushes],
    stateUpdates: [...runtime.stateUpdates],
  }
}

export async function captureBookingRoute(action) {
  try {
    await action()
  } catch (error) {
    if (error instanceof RouteSignal) {
      return { destination: error.destination, kind: error.kind }
    }
    throw error
  }
  return null
}
