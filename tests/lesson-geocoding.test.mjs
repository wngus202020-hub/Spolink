import assert from "node:assert/strict"
import test from "node:test"

await import("./profile-api/fixtures.mjs")

const { geocodingRequestSchema, geocodingResponseSchema } = await import(
  "../lib/maps/geocoding-contract.ts"
)
const { createGeocodingRouteHandler } = await import("../lib/maps/geocoding-route-handler.ts")
const { parseNaverGeocodingResponse } = await import("../lib/maps/naver-geocoding-response.ts")

test("Given a NAVER geocoding response, when parsed, then only bounded canonical locations remain", () => {
  const result = parseNaverGeocodingResponse({
    addresses: [
      {
        jibunAddress: "서울특별시 강남구 역삼동 123",
        roadAddress: "서울특별시 강남구 테헤란로 123",
        x: "127.0312345",
        y: "37.5012345",
      },
      {
        jibunAddress: "잘못된 주소",
        roadAddress: "",
        x: "181",
        y: "37.5",
      },
    ],
    meta: { count: 2, page: 1, totalCount: 2 },
    status: "OK",
  })

  assert.deepEqual(result, [
    {
      address: "서울특별시 강남구 테헤란로 123",
      jibunAddress: "서울특별시 강남구 역삼동 123",
      latitude: 37.5012345,
      longitude: 127.0312345,
      roadAddress: "서울특별시 강남구 테헤란로 123",
    },
  ])
  assert.equal(
    geocodingRequestSchema.safeParse({ query: "  테헤란로 123  " }).data?.query,
    "테헤란로 123",
  )
  assert.equal(geocodingResponseSchema.safeParse({ data: { locations: result } }).success, true)
})

test("Given an approved coach, when a same-origin address query is posted, then results are private", async () => {
  const calls = []
  const handler = createGeocodingRouteHandler({
    geocode: async (query) => {
      calls.push(query)
      return [location()]
    },
    getActorAccess: async () => ({ coachProfileId: "coach-id", kind: "approved_coach" }),
    isConfigured: () => true,
  })

  const response = await handler(jsonRequest({ query: "  테헤란로 123  " }))

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(calls, ["테헤란로 123"])
  assert.deepEqual(await response.json(), { data: { locations: [location()] } })
})

test("Given an unauthorized actor or invalid boundary, when geocoding is requested, then provider quota is protected", async () => {
  let geocodeCount = 0
  const dependencies = {
    geocode: async () => {
      geocodeCount += 1
      return []
    },
    getActorAccess: async () => ({ kind: "unauthenticated" }),
    isConfigured: () => true,
  }
  const handler = createGeocodingRouteHandler(dependencies)

  const unauthorized = await handler(jsonRequest({ query: "테헤란로 123" }))
  const crossOrigin = await handler(
    new Request("http://127.0.0.1:3000/api/maps/geocode", {
      body: JSON.stringify({ query: "테헤란로 123" }),
      headers: { "content-type": "application/json", origin: "https://attacker.invalid" },
      method: "POST",
    }),
  )

  assert.equal(unauthorized.status, 401)
  assert.equal(crossOrigin.status, 403)
  assert.equal(geocodeCount, 0)
})

function jsonRequest(body) {
  return new Request("http://127.0.0.1:3000/api/maps/geocode", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:3000" },
    method: "POST",
  })
}

function location() {
  return {
    address: "서울특별시 강남구 테헤란로 123",
    jibunAddress: "서울특별시 강남구 역삼동 123",
    latitude: 37.5012345,
    longitude: 127.0312345,
    roadAddress: "서울특별시 강남구 테헤란로 123",
  }
}
