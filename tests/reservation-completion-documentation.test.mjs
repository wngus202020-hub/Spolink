import assert from "node:assert/strict"
import test from "node:test"

import { readReservationRouteInventory } from "./reservation-route-inventory.mjs"
import {
  configureReservationRouteModules,
  loadReservationRouteModules,
  reservationRouteModuleCalls,
} from "./reservation-route-module-runtime.mjs"

test("실제 calendar GET과 coach lifecycle POST 모듈은 분리된 method를 안전하게 위임한다", async () => {
  const calendarResponse = new Response("calendar-runtime", { status: 200 })
  const lifecycleResponse = Response.json({ state: "completed" }, { status: 200 })
  configureReservationRouteModules({
    calendarHandler: async () => calendarResponse,
    lifecycleHandler: async () => lifecycleResponse,
  })
  const { calendar, lifecycle } = await loadReservationRouteModules()
  const calendarRequest = new Request(
    "https://spolink.local/api/reservations/reservation-runtime/calendar",
  )
  const lifecycleRequest = new Request(
    "https://spolink.local/api/reservations/reservation-runtime/complete",
    { method: "POST" },
  )

  assert.deepEqual(Object.keys(calendar).sort(), ["GET"])
  assert.deepEqual(Object.keys(lifecycle).sort(), ["POST"])
  assert.equal(
    await calendar.GET(calendarRequest, {
      params: Promise.resolve({ reservationId: "reservation-runtime" }),
    }),
    calendarResponse,
  )
  assert.equal(
    await lifecycle.POST(lifecycleRequest, {
      params: Promise.resolve({ reservationId: "reservation-runtime" }),
    }),
    lifecycleResponse,
  )
  assert.deepEqual(reservationRouteModuleCalls(), {
    calendar: [[calendarRequest, "reservation-runtime"]],
    lifecycle: [[lifecycleRequest, "reservation-runtime"]],
  })
})

test("route와 build inventory는 generic reservation GET 부재와 완료·calendar·lifecycle surface를 증명한다", async () => {
  const inventory = await readReservationRouteInventory()

  assert.equal(inventory.genericRoute, null)
  assert.equal(inventory.completionPage, "app/reservations/[reservationId]/complete/page.tsx")
  assert.deepEqual(inventory.routeModules, [
    "app/api/reservations/[reservationId]/calendar/route.ts",
    "app/api/reservations/[reservationId]/cancel/route.ts",
    "app/api/reservations/[reservationId]/complete/route.ts",
    "app/api/reservations/[reservationId]/no-show/route.ts",
  ])
  if (inventory.buildRoutes) {
    assert.equal(inventory.buildRoutes.includes("/api/reservations/[reservationId]/calendar"), true)
    assert.equal(inventory.buildRoutes.includes("/api/reservations/[reservationId]/complete"), true)
    assert.equal(inventory.buildRoutes.includes("/reservations/[reservationId]/complete"), true)
    assert.equal(inventory.buildRoutes.includes("/api/reservations/[reservationId]"), false)
  }
})
