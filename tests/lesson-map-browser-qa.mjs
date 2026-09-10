import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"

import { chromium } from "@playwright/test"
import { startNextServer } from "./supabase-e2e/next-server.mjs"

const evidenceDir = ".omo/evidence/lesson-map"
let browser = null
let server = null

await mkdir(evidenceDir, { mode: 0o700, recursive: true })

try {
  server = await startNextServer({
    mode: "unconfigured",
    naverMapsClientId: "browser-qa-client-id",
  })
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    baseURL: server.baseUrl,
    viewport: { height: 900, width: 1280 },
  })
  await context.route("https://oapi.map.naver.com/**", async (route) => {
    await route.fulfill({ body: naverMapsStub(), contentType: "text/javascript", status: 200 })
  })
  const page = await context.newPage()
  await page.goto("/lessons")
  await page.getByRole("button", { name: "지도" }).click()
  await page.locator('[data-map-state="ready"]').waitFor()

  const initial = await page.evaluate(() => globalThis.__spolinkNaverQa)
  assert.equal(initial.markerCount, 2)
  assert.equal(initial.fitBoundsCount, 1)
  await page.screenshot({ fullPage: true, path: `${evidenceDir}/desktop-map.png` })

  await page.getByRole("button", { name: /체형 교정 필라테스 소그룹/u }).click()
  assert.equal(
    await page
      .getByRole("button", { name: /체형 교정 필라테스 소그룹/u })
      .getAttribute("aria-pressed"),
    "true",
  )
  const selected = await page.evaluate(() => globalThis.__spolinkNaverQa)
  assert.deepEqual(selected.lastPanTarget, { latitude: 37.5133, longitude: 127.1028 })

  await page.evaluate(() => globalThis.__spolinkNaverQa.clickMarker(0))
  await page
    .locator('button[aria-pressed="true"]')
    .filter({ hasText: "퇴근 후 50분 테니스 입문" })
    .waitFor()

  await page.setViewportSize({ height: 844, width: 390 })
  await page.screenshot({ fullPage: true, path: `${evidenceDir}/mobile-map.png` })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 390), true)
  await context.close()
} finally {
  if (browser) await browser.close()
  if (server) await server.stop()
}

function naverMapsStub() {
  return `
    (() => {
      const state = {
        fitBoundsCount: 0,
        lastPanTarget: null,
        markerCount: 0,
        markers: [],
      };
      class LatLng {
        constructor(latitude, longitude) {
          this.latitude = latitude;
          this.longitude = longitude;
        }
      }
      class LatLngBounds {
        constructor() {}
        extend() { return this; }
      }
      class MapView {
        constructor(element) {
          element.innerHTML = '<div style="position:absolute;inset:0;background:#e7eee9;display:grid;place-items:center;color:#365344;font:700 15px system-ui">서울 레슨 지도</div>';
        }
        destroy() {}
        fitBounds() { state.fitBoundsCount += 1; }
        panTo(position) {
          state.lastPanTarget = { latitude: position.latitude, longitude: position.longitude };
        }
      }
      class Marker {
        constructor(options) {
          this.listeners = {};
          this.options = options;
          state.markers.push(this);
          state.markerCount = state.markers.length;
        }
        setMap() {}
        setZIndex() {}
      }
      const Event = {
        addListener(target, name, listener) { target.listeners[name] = listener; },
        clearInstanceListeners(target) { target.listeners = {}; },
      };
      globalThis.__spolinkNaverQa = {
        clickMarker(index) { state.markers[index]?.listeners.click?.(); },
        get fitBoundsCount() { return state.fitBoundsCount; },
        get lastPanTarget() { return state.lastPanTarget; },
        get markerCount() { return state.markerCount; },
      };
      globalThis.naver = { maps: { Event, LatLng, LatLngBounds, Map: MapView, Marker } };
    })();
  `
}
