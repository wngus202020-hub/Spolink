# COMPONENT GUIDE

## OVERVIEW

`components/` owns reusable presentation and browser interactions. Pages provide authenticated
server data; `lib/` provides domain clients and workflows.

## WHERE TO LOOK

| Area | Location | Pattern |
|------|----------|---------|
| Auth forms | `auth/` | Shared fields/alerts, error focus, safe redirects |
| Home discovery | `home/` | Lesson cards, explicit media fallback, search entry |
| Lesson interactions | `lessons/` | Search picker/dialog, schedules, booking request |
| Profile setup | `onboarding/` | Validated profile mutation |
| Payment action | `payments/` | Prepare-only client flow |
| Shared layout | `layout/` | Account-aware public header |
| Primitives | `ui/` | `Button`, `StatusBadge` |

## CONVENTIONS

- Add `"use client"` only for state, events, browser APIs, or client-side mutation.
- Prefer existing `ui/` primitives and semantic utilities mapped from `app/globals.css`.
- Keep domain request code in an existing `lib/*-client.ts` when one exists.
- Use Lucide icons with `aria-hidden="true"` when decorative; label icon-only controls.
- Associate every input with a visible label and connect errors through `aria-describedby` and
  `aria-invalid`.
- Async errors move focus after React commits the alert; busy forms prevent duplicate submission.
- Dialogs use native `<dialog>`, restore trigger focus, support Escape, and set initial focus.
- Preserve dark mode, reduced motion, keyboard operation, and 390/768/1280 layouts.
- Coach certification UI must expose upload validation, submission status, and admin decisions with
  accessible busy/error/success states; do not imply approval before the server result.

## VISUAL RULES

- Read `SPOLINK_디자인_시스템.md` before visual changes.
- Use semantic colors such as `bg-canvas`, `text-primary`, `border-line`, and status tokens.
- Do not add raw hex colors, arbitrary font scales/spacing, nested cards, or another icon family.
- Media state is explicit `photo | missing`; failed loads fall back without retry loops.

## VERIFY

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test:e2e:direction-alignment
```

Use the focused Auth/payment/reservation E2E command when changing those component domains.
