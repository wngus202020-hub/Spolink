import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("state-changing reservation routes enforce JSON same-origin boundaries", async () => {
  const cancellationAdapter = await read("lib/reservations/cancel-reservation-route-adapter.ts")
  const reservationRoute = await read("app/api/reservations/route.ts")
  const paymentPrepareRoute = await read("app/api/payments/prepare/route.ts")

  for (const source of [cancellationAdapter, reservationRoute, paymentPrepareRoute]) {
    assert.match(source, /hasSameOrigin\(request\)/)
    assert.match(source, /hasJsonContentType\(request\)/)
    assert.match(source, /"UNSUPPORTED_MEDIA_TYPE"/)
    assert.match(source, /"Content-Type must be application\/json\."/)
  }
})

test("RPC array-returning route adapters require exactly one row", async () => {
  const cancellationRoute = await read("app/api/reservations/[reservationId]/cancel/route.ts")
  const paymentPrepareRoute = await read("app/api/payments/prepare/route.ts")

  assert.match(cancellationRoute, /cancellations\?\.length === 1 \? cancellations\[0\] : null/)
  assert.match(
    paymentPrepareRoute,
    /payments\?\.length === 1 \? \(payments\[0\] \?\? null\) : null/,
  )
})

test("standard auth E2E script includes booking confirmation coverage", async () => {
  const packageJson = JSON.parse(await read("package.json"))

  assert.match(packageJson.scripts["test:e2e:auth"], /tests\/auth-ui-e2e\/run\.mjs/)
  assert.match(
    packageJson.scripts["test:e2e:auth"],
    /tests\/auth-ui-e2e\/run-booking-confirmation\.mjs/,
  )
})

async function read(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), "utf8")
}
