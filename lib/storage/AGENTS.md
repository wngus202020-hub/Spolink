# STORAGE DOMAIN GUIDE

## OVERVIEW

`lib/storage/` owns object validation and lifecycle behavior. Supabase Storage policies and domain RPCs
remain the authorization and transaction authority.

## WHERE TO LOOK

| Concern | File |
|---|---|
| Certificate upload, validation, admin signed reads | `coach-certification.ts` |
| Lesson image intent/register/delete/cleanup | `lesson-images.ts` |
| Image bytes and bounded cleanup | `lesson-image-validation.ts` |
| Avatar lifecycle | `../profile/avatar-contract.ts`, `../profile/avatar-client.ts` |
| Storage policies | `../../supabase/migrations/` |

## INVARIANTS

- `coach-certificates` is private. Under the current Storage policy, the applicant owner reads its object
  directly with Storage `SELECT`; do not create or document applicant signed reads.
- An active administrator may receive a signed certificate read URL lasting exactly 300 seconds, only after
  the authorized admin workflow verifies the certificate registration and caller.
- `lesson-images` and `profile-avatars` are public-read buckets. Their public-read status does not permit
  client-selected paths or unrestricted writes. Avatar writes stay owner-scoped; lesson-image writes and
  deletes stay tied to their upload intent and lesson authorization.
- Object names are server-derived and owner-scoped; clients submit bounded metadata, not bucket paths.
- Validate MIME, extension, size, and magic bytes before registration. Certificates are PNG, JPEG, or PDF,
  at most 10 MiB, and cannot be overwritten.
- Lesson image flow is intent -> signed upload -> stored-byte verification -> metadata registration.
  Compensate failed registration by removing the uploaded object.
- Delete is retry-safe: preserve the database deleting receipt when physical removal fails; Storage
  `404` may finalize an already-removed object.
- Opportunistic lesson-image cleanup is bounded, single-flight, and non-blocking to the request path.

## ANTI-PATTERNS

- Do not trust browser MIME, size, owner, object name, ordering, or lifecycle state.
- Do not expose signed URLs, object paths, service-role credentials, or raw provider bodies in logs,
  API errors, screenshots, or evidence.
- Do not weaken RLS/Storage policies or skip compensation to make an upload test pass.

## VERIFY

```bash
corepack pnpm test:coach-certification
node --test tests/lesson-images/*.test.mjs tests/lesson-images/*/*.test.mjs
corepack pnpm test:e2e:profile-avatar
corepack pnpm test:e2e:supabase
```
