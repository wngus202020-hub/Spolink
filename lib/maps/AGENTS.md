# MAPS DOMAIN GUIDE

## OVERVIEW

`lib/maps/` separates server-side NAVER address geocoding from browser-side Dynamic Map loading and
the provider-independent lesson coordinate model.

## WHERE TO LOOK

| Concern | Files |
|---|---|
| Request/response schema and browser client | `geocoding-contract.ts`, `geocoding-client.ts` |
| HTTP boundary and production wiring | `geocoding-route-handler.ts`, `geocoding-default-dependencies.ts` |
| Provider credentials and response parsing | `geocoding-env.ts`, `naver-geocoding*.ts` |
| Browser SDK loader | `naver-maps-browser.ts` |
| Coordinate filtering | `lesson-map-model.ts` |
| UI | `components/lessons/lesson-address-search.tsx`, `components/lessons/lesson-map.tsx` |

## BOUNDARIES

- Geocoding uses server-only `NAVER_MAPS_CLIENT_ID` and `NAVER_MAPS_CLIENT_SECRET`; never expose the
  secret or call the geocoding provider directly from a Client Component.
- Dynamic Map script loading uses only the public client ID returned through the intended page model.
- Parse provider JSON with `naver-geocoding-response.ts`; never pass raw provider payloads to clients.
- Keep address queries trimmed and bounded by `geocodingRequestSchema`; return typed coordinates only.
- Persist selected latitude/longitude through lesson authoring contracts and database RPCs. A marker
  or client-visible address is not authoritative state.
- Lessons without valid coordinates stay in list fallback and are excluded by `selectMappableLessons`.

## DEFERRED

Current-location tracking, distance sorting, bounds-driven requery, and production tile credentials
are outside the current verified boundary. Do not describe them as implemented.

## VERIFY

```bash
node --test tests/lesson-geocoding.test.mjs tests/lesson-map-contract.test.mjs
node --test tests/lesson-location-sql-contract.test.mjs
node tests/lesson-map-browser-qa.mjs
```
