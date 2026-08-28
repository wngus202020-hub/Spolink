# LESSON DOMAIN GUIDE

## SCOPE

`lessons/` separates public discovery/display reads from approved-coach authoring,
schedule lifecycle, and the generated Korean region catalog used by search controls.

## PUBLIC READ MAP

| Concern | Files | Rule |
|---|---|---|
| Search/display | `display-lessons.ts`, `display-lesson-mapper.ts` | active lessons with public relations and available schedules |
| Public HTTP shape | `public-lesson-api.ts`, `public-lesson-subroute-api.ts` | parse bounded list/schedule/review query contracts |
| Search date | `lib/lesson-search.ts` | KST half-open range, not locale display text |
| Public assets | `display-lesson-mapper.ts` | only safe `lesson-images` public-storage paths |

## CONFIGURATION AND FILTERS

- For search, an unconfigured public client returns filtered local demo lessons with status `demo`.
- For search, a configured query with zero eligible schedules returns `success` with `[]`; never substitute demo cards.
- Keep database read failure distinct from both configured-empty and demo mode.
- Date search first finds open, positive-capacity schedules inside the KST `[from, toExclusive)` range, then reads lessons.
- Preserve `openOnly`, `from`, `to`, region, sport, price, keyword, and pagination parsing in the public API contracts.
- Do not treat a display label or stale schedule label as an eligibility decision; use schedule instants and capacity rows.

## COACH AUTHORING MAP

| Layer | Files | Role |
|---|---|---|
| Strict inputs | `authoring-contract.ts`, `authoring-types.ts` | draft, transition, create/update/close schedule schemas |
| Route boundary | `authoring-route-handlers.ts` | authoring operation selection and HTTP status mapping |
| Workflow | `authoring-workflow.ts` | typed result mapping and transition orchestration |
| Persistence | `authoring-repository.ts`, `authoring-server-client.ts` | verified claims and authoring RPC calls |
| Browser/page | `authoring-client.ts`, `coach-authoring-page.ts` | approved-coach UI entry and same-origin requests |

- Lesson and schedule writes flow contract -> route handler -> workflow -> repository/RPC; do not add direct table mutations.
- The authoring repository checks verified claims and owns RPC argument names; keep `database.types.ts` aligned after SQL changes.
- Schedule overlap, closed schedules, and confirmed-reservation edit conflicts are SQL-enforced lifecycle cases.

## REGION GENERATION CHAIN

- Source fixture: `tests/fixtures/regions/molit-legal-districts-20260630.csv` with its `.sha256` companion.
- Generator: `scripts/generate-lesson-regions.mjs`; generated consumer: `lib/lesson-regions.ts`.
- Validate source/version metadata and canonical province/district query values with `tests/lesson-regions.test.mjs`.

## VERIFY

```bash
node --test tests/lesson-search*.test.mjs tests/lesson-authoring-*.test.mjs
node --test tests/lesson-regions.test.mjs tests/public-lesson-subroutes.test.mjs
corepack pnpm test:e2e:supabase
```
