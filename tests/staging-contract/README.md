# Staging Gate 0 Local Handoff

This directory contains local-only contract checks for the hosted Supabase and Vercel staging plan.

Gate 0 evidence is a readiness checklist, not provider proof. A separate Supabase/Vercel staging
deployment was created outside this local contract runner, but the checklist remains `BLOCKED` until
all seven status-only attestations are current. Custom SMTP confirmation/recovery is provider-verified;
GitHub visibility attestation and CI/CD are still missing. Historical notes in
`.omo/notepads/hosted-supabase-vercel-staging/` remain planning context only.

## Status Input

`gate0-resource-readiness.example.json` is intentionally all `BLOCKED`. A provider owner may copy it and change only the seven status values after fresh out-of-band verification.

Allowed values:

- `BLOCKED`: not verified yet, unavailable, or missing owner attestation.
- `VERIFIED`: freshly verified by the provider owner without exposing identifiers or secrets.
- `REJECTED`: contradiction found, production reuse found, or safety requirement failed.

The input must contain exactly these keys:

- `githubPrivateRepository`
- `supabaseStagingProject`
- `vercelStagingTopology`
- `smtpMailbox`
- `cleanupAuthority`
- `stableHttpsOrigin`
- `resourceSeparation`

Do not add resource identifiers, URLs, project refs, owner names, email addresses, UUIDs,
credentials, provider output, comments, or free-form notes. Secrets belong only in provider secret
stores.

## Hosted SMTP Verification

The Mailtrap Sandbox token stays in `SPOLINK_STAGING_MAILTRAP_API_TOKEN` or the macOS Keychain item
`spolink-mailtrap-staging/api-token`. Supabase cleanup authority comes from the approved CI secret
scope or the logged-in local Supabase CLI. Run the real hosted browser flow with:

```bash
SPOLINK_STAGING_BASE_URL=https://spolink-staging.vercel.app \
  corepack pnpm staging:verify:smtp
```

The runner creates one random test account, verifies confirmation and one-time recovery, deletes
only its exact Mailtrap messages and Auth user, and writes redacted status-only evidence.

## Commands

Run the local contract suite first. It writes the default safe `BLOCKED` checklist and never contacts providers.

```bash
corepack pnpm staging:contract
```

Generate evidence from the status-only example:

```bash
node tests/staging-contract/write-gate0-checklist.mjs \
  --input tests/staging-contract/gate0-resource-readiness.example.json \
  --output .omo/evidence/staging/gate-0-provider-checklist.json
```

Expected result for the example is `BLOCKED`, `providerCommandsStarted: 0`, and `identifiersRecorded: false`.

## Boundaries

This workflow does not run Git commands, provider CLIs, provider APIs, deployments, migrations, Docker, or local Supabase lifecycle commands. `APPROVE` means only that all seven status values were owner-attested as `VERIFIED`; it still must not be treated as a production release or as permission to run hosted migrations without the later dry-run hash gate.
