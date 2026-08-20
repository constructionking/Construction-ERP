# Construction ERP — project guide

ERP for an Indian construction company (₹, metric units, monsoon-aware
scheduling). Three Phase-1 roles with strict limited access:

- **Owner** (`users.isOwner`) — sees everything, edits anything (always with a
  mandatory reason, always logged in `edit_log`), locks Gantt baselines, sets
  labour cost benchmarks, reviews audit flags and amendments.
- **Site Engineer** (`site_roles.role = engineer`, per site) — progress +
  photos, measurement book upload, material receipts + quality flag,
  consumption, stockpile scans, requisitions, departmental labour entries.
  NO access to financial dashboards (server-enforced).
- **Accounts** (`site_roles.role = accounts`) — fund requisition approvals
  ONLY.

## Core invariants — never break these

1. **Append-only records.** Submittable tables use single-table versioning
   (`entityId`, `version`, `isCurrent`, `status`). Postgres triggers reject
   UPDATE/DELETE on `submitted` rows. Never bypass with raw SQL. Amendments go
   through `src/lib/versioning/amend.ts` only (new version + mandatory reason
   + `edit_log` diff).
2. **Cross-record references point at `entityId`**, never at a version row id.
3. **RBAC is enforced in route handlers** via `guard()` from
   `src/lib/auth/guard.ts` + the policy map in `src/lib/auth/policies.ts`.
   UI hiding is cosmetic; the API is the boundary. Every new route calls
   `guard()` first.
4. **AI estimates never overwrite human data** — stored beside it; mismatches
   become `audit_flags`.
5. Amendment windows are owner-configurable in `amendment_policies`
   (seeded defaults in `prisma/seed.ts`). Day-close (23:59 IST) gates
   `until_day_close` windows.

## Stack & layout

Next.js 15 App Router + TS, Tailwind v4 (in-house UI kit at
`src/components/ui.tsx`), Prisma + PostgreSQL 16, custom JWT auth
(jose, httpOnly cookie; token carries userId only — roles are re-read from DB
in `guard()`), pg-boss jobs (Node worker `src/worker/index.ts`), Python
photogrammetry worker (`worker-photogrammetry/`, polls `scan_jobs` with
`FOR UPDATE SKIP LOCKED`). Storage via `src/lib/storage` (local disk dev,
S3 prod). Claude API for photo-progress estimates + MB anomaly assist
(optional; app degrades gracefully without `ANTHROPIC_API_KEY`).

Dev: `docker compose up -d postgres` (or a local Postgres 16 with the same
DSN), `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`, `pnpm worker`.
Tests: `pnpm test:unit` (no DB), `pnpm test:integration` (needs DB).

## Phase 2 spec (agreed with the owner — build later, hooks already in schema)

1. **Purchase department role** (`site_roles.role = purchase`, enum already
   present). Engineers raise material demands to Purchase. Purchase dashboard:
   demand list (TMT, bricks, sand, cement…) with, per material: total BOQ qty
   laid down, qty already purchased, qty remaining; if a demand exceeds
   remaining BOQ, auto-append a remark on the demand row. Schema hooks:
   `activities.boqRate`, requisition kind extensible.
2. **Billing Engineer role** (`billing_engineer` enum present). Uploads
   contractor RA (running account) bills as XLSX. App detects grammatical,
   logical and mathematical errors; billing engineer accepts/rejects each
   flagged change and the FULL accept/reject log is stored for owner review.
3. **Accounts ↔ Billing Engineer messaging** on a bill: structured error
   annotations (pick error type — rate mismatch / qty exceeds MB / arithmetic /
   double entry / other + pointer to row) instead of free-text back-and-forth.
   Iterates until Accounts is satisfied, then forwards to Owner.
4. **Owner pending payments list**: approved bills awaiting payment, as a
   list. Audit must flag: double billing (same work billed twice across RA
   bills), misrepresentation vs measurement book, arithmetic errors, billed
   qty exceeding work order / BOQ.

## Notifications & the fund chain

- User-facing alerts go through `notifyUsers()` in `src/lib/notify.ts` — it
  writes the in-app notification AND fires web push (`src/lib/push.ts`,
  VAPID keys in env; degrades to in-app-only without them). Never call
  `prisma.notification.createMany` directly.
- Fund requisitions follow a three-step chain, derived from the append-only
  `approval_actions` log in `src/lib/requisitions.ts` (`deriveState`):
  engineer raises (push → accounts) → accounts approves AS-IS (push → owner,
  state `awaiting_owner`) → owner `owner_approved` (push → accounts,
  `awaiting_release`) → accounts `released` (terminal — the ONLY alert the
  engineer receives in the whole chain). If accounts wants a different
  amount, `partially_approved` = "change requested": the request goes BACK
  to the engineer (state `changes_requested`, push → engineer) to revise and
  resubmit; it never moves forward at a changed amount. The engineer stays
  silent through all approval hops. Transition legality lives in
  `ACCOUNTS_FUND_ACTIONS` / `OWNER_FUND_ACTIONS` and is enforced in the
  actions route. Material requests stay single-step (owner decides).
- Every release lands in the owner's dated/timed release log
  (`src/lib/reports/releases.ts`, rendered on the site Approvals tab) —
  derived from the immutable action chain, never stored mutable.
- Daily 6 pm IST reminder (`src/worker/reminder-jobs.ts`) nudges engineers
  who haven't recorded consumption for the day.

## Security invariants

- Login goes through the durable lockout in `src/lib/auth/lockout.ts`
  (DB-backed `login_attempts`; per-account exponential backoff + per-IP
  brake) with a timing-equalizing dummy bcrypt compare. Never add an
  auth path that skips it.
- Session JWTs carry `tokenVersion`; `loadCtx()` rejects stale versions.
  Password change and the owner's revoke-sessions endpoint bump it.
- Uploads are verified by MAGIC BYTES (`src/lib/uploads.ts`), never by the
  client-declared MIME type; files are served with nosniff +
  Content-Disposition and a content-type whitelist.
- Passwords must pass `src/lib/auth/password.ts` (min 10, common-list
  reject, bcrypt cost 12).
- Security headers/CSP live in `next.config.ts` — keep CSP self-only; no
  third-party script origins.
- `pnpm audit --prod` must stay clean (pnpm.overrides pin patched
  transitive deps).

## Conventions

- Dates that are business dates use `@db.Date` and the `yyyy-mm-dd` string
  form at API boundaries; IST offset handling lives in
  `src/lib/versioning/day-close.ts`.
- Money: Prisma `Decimal(14,2)`; format with `src/lib/format/inr.ts`
  (lakhs/crores).
- Quantities: `Decimal(14,3)` + `Unit` enum; format with
  `src/lib/format/units.ts`.
- New audit rules: pure functions in `src/lib/audit/rules/`, registered in
  `engine.ts`, table-driven tests in `tests/unit/audit/`.
