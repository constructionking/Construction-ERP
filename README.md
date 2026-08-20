# Construction ERP

Site monitoring, inventory, approvals and audit for a construction company.
Mobile-first PWA for site engineers; analytical desktop dashboard for the
owner; a focused approvals queue for accounts.

## Highlights

- **Strict limited access** — engineer / accounts / owner see only what their
  role needs, enforced server-side on every API route.
- **Append-only records** — nothing is editable after submission (database
  triggers, not just app logic). Corrections are reasoned amendments that
  keep full history, reviewable by the owner.
- **Progress tracking** — daily quantities per activity, geotagged photos,
  measurement book XLSX upload (preset template, row-wise validation),
  AI photo-progress estimates stored beside (never instead of) engineer data.
- **Gantt & schedule** — suggested dates from BOQ + productivity norms with
  monsoon-season derating; owner reviews, adjusts and locks the baseline;
  forecast vs baseline with >10% contractor-delay flags.
- **Inventory** — receipts with quality check, consumption vs mix-design
  theoretical usage with real-time variance audit, running stock.
- **Stockpile scan** — guided photo-orbit capture on any phone, server-side
  photogrammetry (scale marker), engineer accept/reject with variance
  reported to owner; shape-template fallback; LiDAR-ready scan API.
- **Requisitions** — material/fund requests routed to the right approver,
  append-only decision log, mandatory reasons on rejection. Fund requests
  run a three-step chain: accounts approves → owner final approval →
  accounts releases the money, with a push notification at every hand-off.
- **Push notifications (PWA)** — device push for fund-request hand-offs,
  audit flags and a daily 6 pm reminder to engineers who haven't entered
  consumption. Enable per device via the 🔔 button; set VAPID keys in .env.
- **Departmental labour** — day-rate (morning market) vs period (contractor)
  entries, owner benchmarks per mtr/CUM/sqm, cost-overrun flags.
- **Audit engine** — consumption variance, labour cost, contractor delay,
  scan variance, receipt/requisition mismatch — surfaced as severity-ranked
  flags on the owner dashboard.

## Getting started (development)

```bash
cp .env.example .env             # set AUTH_SECRET
docker compose up -d postgres    # or any local PostgreSQL 16
pnpm install
pnpm db:migrate
pnpm db:seed                     # demo site + owner/engineer/accounts logins
pnpm dev                         # web app on :3000
pnpm worker                      # background jobs (AI, forecasts, day-close)
docker compose --profile scan up -d   # photogrammetry worker (optional)
```

Demo logins after seeding (password `demo1234` for all):

| Role | Email |
|---|---|
| Owner | owner@demo.erp |
| Site engineer | engineer@demo.erp |
| Accounts | accounts@demo.erp |

## Tests

```bash
pnpm test:unit          # pure logic: audit rules, schedule math, parser, RBAC matrix
pnpm test:integration   # API + immutability triggers against real Postgres
```

## Structure

See `CLAUDE.md` for architecture, invariants and the Phase 2 roadmap
(purchase department, RA bill audit, billing workflow).
