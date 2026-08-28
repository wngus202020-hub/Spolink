# PROFILE DOMAIN GUIDE

Profile APIs own learner profile creation and owner-scoped reads/edits for `/api/profiles/me`.

## FLOW

- `validation.ts`: strict Zod boundary for POST/PATCH bodies; trims accepted strings and rejects system fields.
- `route-handlers.ts`: enforce same-origin and JSON before parsing; check configuration before creating Supabase clients.
- `workflow.ts`: authenticate, classify account/profile state, apply profile policy, then map the response.
- `supabase-repository.ts`: persistence only; map camelCase workflow inputs to `profiles` columns.
- `default-route-dependencies.ts`: production wiring for cookie-aware server Supabase and workflow dependencies.

## IDENTITY

- `getVerifiedAuthUser` must derive the owner from `supabase.auth.getClaims().data.claims.sub`.
- Never authorize from request JSON, URL parameters, a client-supplied profile id, or `getUser()`.
- PATCH and GET read/update only the verified subject's profile; restricted or deleted profiles stop before mutation.
- Repository calls use the request's authenticated Supabase client. Service-role access is not a profile route shortcut.

## CREATE VS PATCH

- POST is onboarding: require the complete create schema, then insert `role: "learner"` and `status: "active"`.
- Duplicate POST maps to `PROFILE_ALREADY_EXISTS`; do not turn it into an update.
- PATCH is partial. `buildProfileUpdate` writes only supplied fields; omitted fields must remain byte-exact.
- `edit-contract.ts` is the browser-safe edit boundary. `buildProfileEditPatch` returns only changed fields, or `null` for no changes.
- Keep `PROFILE_EDIT_PATCH_KEYS` authoritative for UI-editable fields: display name, real name, phone, region, and two consents.
- Do not add avatar, owner, role, status, deletion, or timestamp fields to that browser allowlist.

## REGION

- `region-contract.ts` derives canonical values from `lessonRegions` province/district `queryValue` entries.
- Normalize surrounding whitespace, then validate exact catalog membership; do not accept aliases or free text.
- POST `defaultRegion` is required and non-null. PATCH accepts a canonical value, `null`, or omission.
- GET preserves an existing legacy value byte-exactly; an omitted unrelated PATCH must not migrate it.
- `profiles.default_region` stays nullable text. Do not add automatic migration or a DB CHECK for this UI boundary.

## CONSENT AND HEADERS

- Workflow owns `location_agreed_at` and `marketing_agreed_at`; clients never submit timestamps.
- Create records `now` only when the matching consent is true; PATCH sets `null` on withdrawal.
- PATCH true records `now` only when the existing timestamp is null, preserving prior consent time.
- Pass the `Headers` object through `createSupabaseServerClient`; refreshed cookie `Set-Cookie` values must reach the response.
- `apiDataResponse` and `apiErrorResponse` enforce `Cache-Control: private, no-store` for every profile response.

## ANTI-PATTERNS

- Do not bypass validation, same-origin, content-type, config, or verified-claims ordering in a route factory.
- Do not trust client timestamps, actor ids, system columns, noncanonical regions, or raw database errors in HTTP output.
- Do not replace a changed-only UI PATCH with a full-row overwrite or silently rewrite legacy region data.

## VERIFY

- Focused contracts: `corepack pnpm test:api:contracts`.
- Profile cases live under `tests/profile-api/`: validation, region, repository identity, route precedence, mutation, and lifecycle contracts.
- Type boundary: `corepack pnpm typecheck`.
- Formatting/static check: `corepack pnpm lint`.
