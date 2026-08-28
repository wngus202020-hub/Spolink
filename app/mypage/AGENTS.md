# AUTHENTICATED MEMBER ROUTE GUIDE

`app/mypage/` owns authenticated member pages: account entry, profile, reservations, favorites, notifications, reviews, and trust-safety.

## WHERE TO LOOK

- `page.tsx`: authenticated member hub and navigation targets.
- `profile/page.tsx`: server-loaded profile edit shell; `profile/loading.tsx` and `profile/error.tsx` are its local boundaries.
- `reservations/page.tsx`: `status`/`page` query normalization, paginated read model, and filter links.
- `reservations/[reservationId]/page.tsx`: detail read with owner ID, current payment/refund state, and safe `next` path.
- `reviews/new/page.tsx`: `reservationId` query read and completed-owner eligibility before rendering `ReviewForm`.
- `trust-safety/page.tsx`: authenticated report/block reads composed into `TrustSafetyPanel`.
- `lib/auth/page-auth.ts`: shared suspended/deleted account boundary used by every protected member page.

## ROUTE SHAPE

- Call `readPageAuthProfile()` before member data reads; handle `unauthenticated`/`unconfigured` with the route's exact `/auth/login?next=...` path.
- Send `profile_required` to `/onboarding/profile`; suspended/deleted states remain owned by `readPageAuthProfile()`.
- Keep `dynamic = "force-dynamic"` and `revalidate = 0` on cookie- and account-dependent pages. Initial member reads must remain fresh and private.
- Compose on the server: authenticate, read the typed model, then pass serializable initial data to `PublicHeader` and client children such as `ProfileEditForm` or `NotificationList`.

## OWNERSHIP AND STATE

- Pass `auth.profile.id` into reservation/favorite/read-model calls; a route guard or visible client state is not authorization.
- Reservation detail reads must recheck both reservation ownership and current status before exposing payment, completion, review, or refund information.
- The review page must recheck the supplied reservation ID for the signed-in member and require the completed state before showing `ReviewForm`.
- Keep state transitions and policy calculations in `lib/` workflows/read models; pages only classify and compose the result.

## QUERY AND CONTEXT

- Await Next 16 `searchParams`; accept `string | string[]` and normalize through the existing read-model helpers.
- Preserve reservation filters when building pagination links; use `URLSearchParams` rather than hand-built query strings.
- Preserve contextual `reservationId`, `targetType`, and `targetId` when moving from reservation detail to review or trust-safety surfaces.
- Encode dynamic IDs in links and preserve the complete member route in login `next` values.

## LOCAL UI STATES

- Keep profile loading/error behavior beside `/mypage/profile`: loading exposes `aria-busy`, and the client error boundary calls its supplied `reset`.
- Profile read failure copy must stay Korean, actionable, and local to the profile segment; do not replace the boundary with a blank or cached shell.
- For list reads, render the established `read_failure`, `empty`, and `ready` states without leaking private records or treating failure as empty data.

## RESPONSIVE CHECK

- At 390px: verify no heading, form control, filter, ID, or action wraps outside its container; profile loading/error states remain usable.
- At 768px: verify two-column form/list transitions, query filter controls, and server-provided initial data remain stable.
- At 1280px: verify max-width composition, reservation detail sidebar, navigation, and no horizontal overflow.

## ANTI-PATTERNS

- Do not read member data before the auth/profile redirect branches or trust a client-supplied member ID.
- Do not cache account-dependent pages, duplicate restricted-account redirects, or expose provider/payment secrets in page props.
- Do not drop existing query context when adding links, replace typed read models with ad hoc Supabase reads, or move server-only clients into client components.
- Do not remove the profile-local `loading.tsx`/`error.tsx` pair or silently turn read failures into empty states.

## VERIFY

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm test:api`
- `corepack pnpm test:e2e:profile-edit` for profile redirects, local states, and desktop/tablet/mobile evidence.
- `SPOLINK_VISUAL_QA_DIR=.omo/evidence/mypage-reservations-20260827/screenshots corepack pnpm test:e2e:reservations .omo/evidence/mypage-reservations-20260827/focused-summary.json` for member ownership, reservation state, filters, detail navigation, and 390/768/1280px evidence.
- `corepack pnpm dev`, then inspect `/mypage`, `/mypage/profile`, `/mypage/reservations`, and `/mypage/trust-safety` at 390/768/1280px.
