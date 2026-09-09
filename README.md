# Executive Dashboard

Operations dashboard for EZ Management LLC. One page that gives an at-a-glance
portfolio overview plus a live, per-person task board seeded from the
company's real Claude Cowork automations — so the team has a single place to
see what's due today, check it off, and see new items land as automations
(or people) add them.

## What it does

- **Portfolio overview** — occupancy, vacancy, rent collection, outstanding
  balance, NOI, and today's task counts, seeded from the latest EZ Management
  KPI Ledger snapshot (Sep 3, 2026 Buildium sync). Push a fresh snapshot any
  time via `POST /api/kpi`.
- **Team task board** — one column per team member, with today's tasks and a
  checkbox to mark each done. Tasks materialize automatically from 21
  recurring templates that mirror the company's actual live Cowork
  automations (Daily Gmail Triage, Tenant Complaint SLA Check, Weekly
  Delinquency Digest, AP Bill Draft-Entry, Lease Renewal Window Tracker,
  etc.) — each carries its real cadence, category, and SOP reference.
- **Live pop-up** — the board is backed by Server-Sent Events. Any task
  created anywhere (the UI, or a `POST` to the API) appears on every open
  browser within a second, with a toast and a highlight animation. No
  refresh needed. On a host that can't hold a stream open (serverless —
  see below), the dashboard detects that within ~8s and falls back to
  polling every ~45s automatically, so it still stays fresh without a
  working push connection.
- **Automations tab** — a read-only-by-default table of the 21 recurring
  templates (who they're for, cadence, SOP), with a pause/resume toggle if
  one shouldn't post tasks for a while.
- **Add tasks manually** — anyone can drop in an ad-hoc task for themself or
  a teammate from the "+ Add task" button.

## Architecture

```
server/   Express API, business logic — runs standalone or embedded
api/      Vercel serverless entry point (wraps server/src/app.js)
client/   React (Vite) single-page dashboard
```

Backend is Postgres (via `pg`), not SQLite — a shared, multi-viewer tool
needs a real database reachable from wherever the app runs, and a
serverless host (see Deploying to Vercel, below) has no persistent local
disk to put a SQLite file on anyway.

- `server/src/db.js` — connects via `POSTGRES_URL` or `DATABASE_URL`;
  `ensureSchema()` creates `team_members`, `task_templates` (+
  `template_assignees`), `tasks` (+ `task_assignees`), `kpi_snapshots` if
  they don't exist yet.
- `server/src/seed.js` — one-time seed: the real team roster, the 21
  automation-derived templates, and the KPI snapshot. Only runs against an
  empty database, so it's safe to leave in place.
- `server/src/cronMatch.js` — tiny day-level cron matcher (day-of-month /
  month / weekday only — minute/hour don't matter for "does this fire
  today").
- `server/src/materializer.js` — turns each active template that fires
  today into a concrete task row, idempotently (unique index on
  `template_id + due_date`).
- `server/src/app.js` — the Express app and all routes (no `listen()` —
  reusable by both entry points below).
- `server/src/index.js` — local/long-running entry point: calls `app.listen`
  and re-checks the materializer hourly (for a process that stays up across
  midnight).
- `api/index.js` — Vercel serverless entry point: exports the same Express
  app directly (Vercel's Node runtime accepts an Express app as a
  `(req, res)` handler).

## Running it locally

Needs a Postgres database reachable via `POSTGRES_URL` (or `DATABASE_URL`).
For a quick local one: `createdb exec_dashboard` (or `docker run -p 5432:5432
-e POSTGRES_PASSWORD=postgres postgres:16`).

```bash
npm run install:all   # installs server + client deps
POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/exec_dashboard npm run dev
```

Open http://localhost:5173. The API is proxied under `/api` by Vite in dev.

## Deploying to Vercel

1. Add a Postgres database: in the Vercel project's **Storage** tab, add
   **Vercel Postgres** (or point `DATABASE_URL` at any Postgres — Neon,
   Supabase, etc.). This automatically sets `POSTGRES_URL` for the deployed
   app; `server/src/db.js` picks it up with no other config.
2. Import this repo into Vercel ("Add New… → Project", pick this repo).
   `vercel.json` at the repo root already configures the install/build
   commands and routes `/api/*` to the single serverless function in
   `api/index.js` — no extra setup needed in the Vercel dashboard.
3. Deploy. The first request seeds the database automatically (same
   one-time seed as local dev).

Note: `/api/stream` (SSE) can't hold a connection open on serverless — see
"Live pop-up" above for how the dashboard degrades to polling automatically
when that's the case, so the board still stays fresh either way.

No auth is wired up yet — this is built as an internal tool. Put it behind
your existing SSO/VPN or a Vercel deployment-protection password, or ask for
a login gate to be added, before sharing the URL outside the team.

## Wiring real automations into the live feed

Today the 21 templates materialize their own task each day on schedule, so
the board already reflects the full automation roster without any changes
elsewhere. To make an automation's own *findings* (e.g. "3 leases expiring in
14 days: ...") show up as individual tasks the moment it runs — rather than
one generic "Lease Renewal Window Tracker" placeholder each week — have that
Cowork routine finish with a call like:

```
POST /api/tasks   (or the alias /api/ingest)
Content-Type: application/json

{
  "title": "Lease renewal due: 62 Coleman St 3D (14 days)",
  "description": "Tenant: ... Started SOP-LEA-06 renewal? not yet.",
  "category": "leasing",
  "sop_ref": "SOP-LEA-06",
  "assignee_names": ["Adelin Ayon"],
  "source": "automation"
}
```

That's a change to the routine's own instructions (via `update_trigger`), not
to this app.

**Planned next step (pending deployment):** a new, lightweight Cowork
Routine on a 5-10 minute cadence that checks only fast-moving signals via
the Gmail connector (no Buildium browser automation, to avoid hammering
Buildium every few minutes) and pushes anything new straight to `/api/tasks`
or `/api/kpi`. The other 21 templates keep their current daily/weekly/
monthly cadence — those SOPs (delinquency, lease renewals, owner statements)
don't change fast enough to justify 5-10 minute Buildium scraping, and doing
that for all of them would mean ~150-280 automation runs/day. This routine
needs the app's real deployed URL to point at — set up once the app is live
on Vercel (or wherever it ends up).

## Team roster & templates

The roster and the 21 templates were pulled from the account's live Cowork
Routines and the Buildium user list referenced in them. A few people
(Vanessa, Fidel, Menachem Cohen, Sara Fedorovsky, Yosef Ben Shabbat) are
listed with placeholder roles since no automation names their specific
duties yet — edit them via `PATCH /api/team/:id`, or ask for a "manage team"
panel in the UI if that should be editable by hand day-to-day.

The KPI Ledger artifact the company already has
(`EZ Management KPI Ledger`) remains the deeper financial dashboard; this
board is the operational/task layer on top and links out to it rather than
duplicating its charts.
