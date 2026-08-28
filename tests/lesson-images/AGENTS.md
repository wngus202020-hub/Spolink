# LESSON IMAGE TEST GUIDE

## OVERVIEW

`lesson-images/` covers image route contracts, private upload lifecycle, ordering/deletion,
idempotency, authoring UI, public gallery rendering, and sealed browser evidence.

## STRUCTURE

```text
lesson-images/
├── route/                  # Request validation and route lifecycle
├── storage/                # Intent, blob, registration, deletion, cleanup
├── idempotency/            # Retry and concurrent database cases
├── authoring-model/        # Draft/action/retry client state
├── authoring-browser/      # Coach authoring browser scenarios
├── public-gallery-browser/ # Public rendering, telemetry, screenshots
└── task10-browser/         # Owned process, source binding, publication
```

## REQUIRED CONTRACTS

- Upload intent precedes signing; object names are server-derived and immutable.
- Validate MIME, magic bytes, actual size, owner, lesson state, intent expiry, and exact object path.
- Registration verifies stored bytes before RPC finalization and compensates failed metadata writes.
- Reorder/delete use optimistic state, owner authorization, deterministic RPC results, and retry-safe
  deletion finalization. Storage `404` may finalize an already-deleting object; provider failures stay retryable.
- Opportunistic cleanup is bounded and single-flight. One failed claim must not block independent claims.
- Public galleries expose ordered public images only and retain explicit `photo | missing` fallbacks.

## RUNNER AND EVIDENCE

- Node contract files end in `.test.mjs`; browser orchestrators own their server, fixture, process,
  screenshot, and cleanup lifecycle instead of borrowing unmanaged runtime state.
- Task 10 evidence binds repository/worktree source state, process results, visual files, and hashes.
- Private evidence files are `0600`, directories `0700`; reject traversal, links, stale hashes, and
  copied trace references that cannot be resolved exactly.
- Sanitize Playwright traces before publication and rescan the final archive. Never retain raw JWT,
  cookie, authorization, key, email, UUID, signed URL, Storage path, or provider body.

## VERIFY

```bash
node --test tests/lesson-images/*.test.mjs tests/lesson-images/*/*.test.mjs
corepack pnpm test:high-priority:contracts
corepack pnpm test:e2e:supabase
corepack pnpm supabase:assert-stopped
```

Run browser QA through its owned orchestrator and caller-supplied evidence directory; do not publish
hand-written screenshots or edit sealed evidence in place.
