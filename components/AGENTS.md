# COMPONENT GUIDE

## OVERVIEW

`components/` owns reusable presentation and browser interactions. Pages provide authenticated
server data; `lib/` owns domain clients and workflows.

## WHERE TO LOOK

| Area | Location | Boundary |
|------|----------|----------|
| Auth and profile | `auth/`, `onboarding/`, `profile/` | Shared fields, profile editing, error focus, safe redirects |
| Discovery and home | `home/`, `lessons/` | Cards, explicit media, query controls, booking handoff |
| Coach authoring | `coach/`, `lessons/` | Application, lesson drafts, schedules; clients in `lib/lessons/` |
| Admin operations | `admin/` | Certification, lesson, report, and reservation actions; route policy in `app/admin/`, `lib/*/` |
| Favorites and alerts | `favorites/`, `notifications/` | Member mutations/read state; clients in `lib/favorites/`, `lib/notifications/` |
| Reviews and safety | `reviews/`, `trust-safety/` | Owner/report actions; contracts and workflows in matching `lib/` domains |
| Reservations and money | `reservations/`, `payments/`, `money/` | Booking/lifecycle, prepare-only payment, refunds and settlements; never recreate server transitions |
| Shared frame | `layout/`, `ui/` | Account-aware header and existing `Button`/`StatusBadge` primitives |

## CONVENTIONS

- Add `"use client"` only for state, events, browser APIs, or client-side mutation.
- Prefer existing `ui/` primitives and semantic utilities mapped from `app/globals.css`.
- Keep request code in the matching existing `lib/*-client.ts` or domain client; components do not
  invent authority, money amounts, reservation state, or admin decisions.
- Use Lucide only; decorative icons are `aria-hidden="true"`, icon-only controls have a label.
- Inputs have visible labels; wire errors through `aria-describedby` and `aria-invalid`.
- After React commits an async error, focus its alert; busy forms block duplicate submission.
- `ProfileEditForm` sends changed-only profile PATCH data through `lib/profile/edit-client.ts`;
  `ProfileRegionPicker` accepts only canonical `lessonRegions` values and never persists free text.
- Dialogs use native `<dialog>`, initial focus, Escape dismissal, and trigger-focus restoration.
- Preserve keyboard operation, dark mode, reduced motion, and 390/768/1280 responsive states.
- Certification UI shows upload validation, submitted status, and returned admin decisions only.

## VISUAL RULES

- Read `SPOLINK_디자인_시스템.md` before visual changes; use semantic tokens such as `bg-canvas`,
  `text-primary`, `border-line`, and status tokens.
- Do not add raw hex, arbitrary type/spacing, nested cards, or another icon family.
- Lesson media is an explicit `photo | missing` state with a no-loop fallback. Raw hex inside a
  source image asset is not a component-styling precedent.

## VERIFY

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test:e2e:direction-alignment
```

Run the focused Auth, payment, reservation, coach, or member-domain suite when changing that flow.
