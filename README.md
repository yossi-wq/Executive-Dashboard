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
  refresh needed.
- **Automations tab** — a read-only-by-default table of the 21 recurring
  templates (who they're for, cadence, SOP), with a pause/resume toggle if
  one shouldn't post tasks for a while.
- **Add tasks manually** — anyone can drop in an ad-hoc task for themself or
  a teammate from the "+ Add task" button.

## Architecture

```
server/   Express API + SQLite (better-sqlite3), no external DB to run
client/   React (Vite) single-page dashboard
```

- `server/src/db.js` — schema: `team_members`, `task_templates` (+
  `template_assignees`), `tasks` (+ `task_assignees`), `kpi_snapshots`.
- `server/src/seed.js` — one-time seed: the real team roster, the 21
  automation-derived templates, and the KPI snapshot. Only runs on an empty
  database, so it's safe to leave in place.
- `server/src/cronMatch.js` — tiny day-level cron matcher (day-of-month /
  month / weekday only — minute/hour don't matter for "does this fire
  today").
- `server/src/materializer.js` — on boot (and hourly after), turns each
  active template that fires today into a concrete task row, idempotently
  (unique index on `template_id + due_date`).
- `server/src/index.js` — REST API + `/api/stream` (SSE).

## Running it

```bash
npm run install:all   # installs server + client deps
npm run dev            # runs API on :4000 and the dashboard on :5173
```

Open http://localhost:5173. The API is proxied under `/api` by Vite in dev.

For production, `npm run build` builds the client to `client/dist/`; serve
that as static files (e.g. behind nginx or the same Express process) and run
`npm start` for the API. `better-sqlite3` needs a real, persistent
filesystem — deploy to a VPS/container/Fly/Railway-style host rather than a
serverless function platform.

No auth is wired up yet — this is built as an internal tool. Put it behind
your existing SSO/VPN, or ask for a login gate to be added, before exposing
it outside the office network.

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
to this app — happy to wire specific ones up on request, since it touches
live production automations.

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
