# REVIEWS DOMAIN GUIDE

## OVERVIEW

`lib/reviews/` owns review creation, administrator hiding, and learner-owned review history reads.
Database RPCs remain authoritative for eligibility, ownership, moderation, and idempotency.

## WHERE TO LOOK

| Concern | Files |
|---|---|
| Request schemas | `contract.ts` |
| Create/hide workflows | `workflow.ts`, `repository.ts`, `route-handler.ts` |
| Owner history query | `read-query.ts`, `read-data.ts`, `read-types.ts` |
| UI-safe projection | `read-presentation.ts`, `read-model.ts` |
| Request session | `server.ts` |
| Public creation/read routes | `app/api/reviews/route.ts`, `app/api/lessons/[lessonId]/reviews/route.ts` |
| Admin moderation route | `app/api/admin/reviews/[reviewId]/hide/route.ts` |
| Mypage entry points | `app/mypage/reviews/page.tsx`, `app/mypage/reviews/new/page.tsx` |

## CONVENTIONS

- Review creation accepts reservation ID, rating, and bounded content only. The RPC derives learner,
  lesson, coach, completion eligibility, and one-review-per-reservation ownership.
- Administrator hiding accepts a bounded reason and review ID; reviewer identity, timestamp, status,
  audit data, and notification effects are server/RPC-owned.
- Owner history first filters by `reviewer_id` and `visible|hidden`. Deleted reviews never enter the
  view model; hidden reviews remain visible to their owner with a safe fallback reason.
- Service-role enrichment may read only the lesson/coach IDs selected by the owner-scoped query.
  A lesson link is emitted only for an active lesson with an approved matching coach.
- Keep pagination at `REVIEWS_PER_PAGE = 20`, deterministic newest-first ordering, and stable status
  labels unless API, screen, and browser contracts change together.

## ANTI-PATTERNS

- Do not write `reviews` directly or accept reviewer, coach, lesson, status, hidden reason, or audit
  fields beyond the documented command inputs.
- Do not use service-role reads to select owner reviews or expose foreign, deleted, hidden-public,
  raw profile, payment, reservation, or provider fields.
- Do not treat hidden reviews as deleted or make unavailable lessons clickable.

## VERIFY

```bash
node --test tests/reviews*.test.mjs tests/mypage-reviews-ui*.test.mjs
corepack pnpm test:e2e:reservations
corepack pnpm test:api:contracts
```

- Live RPC/RLS lifecycle: `tests/supabase-e2e/reviews-lifecycle.mjs` via `corepack pnpm test:e2e:supabase`.
- Browser lanes: `tests/auth-ui-e2e/reviews.spec.ts` and `tests/auth-ui-e2e/mypage-reviews.spec.ts`.
