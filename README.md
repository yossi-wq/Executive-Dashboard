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

## Fast Gmail signal check (built into the app, not a Cowork Routine)

The original plan was a Cowork Routine on a 5-10 minute cadence checking
Gmail for anything urgent between the daily/weekly automations above. Two
platform limits made that impossible: this account's Routines can't fire
more often than hourly, and (separately) can't be granted Gmail connector
access via the API used to create them at all. So this is built directly
into the app instead, with its own Gmail OAuth connection and an external
scheduler that isn't subject to either limit:

- `server/src/gmail.js` — OAuth token exchange/refresh and a minimal Gmail
  REST client (no `googleapis` dependency needed).
- `GET /api/auth/gmail/start` / `GET /api/auth/gmail/callback` — one-time
  consent flow; the refresh token lands in the `app_settings` table.
- `POST /api/cron/gmail-check` — checks unread mail from roughly the last
  75 minutes, flags anything matching an urgent/maintenance keyword pattern
  that isn't already represented by an open task on the board, and creates
  it. Requires an `x-cron-secret` header matching `CRON_SECRET` — it's meant
  to be called only by the scheduler below, not browsed to directly.
- `.github/workflows/gmail-poll.yml` — a GitHub Actions scheduled workflow
  (every 7 minutes — GitHub's own minimum granularity is 5) that calls
  `/api/cron/gmail-check`. Runs are best-effort/can slip under load, and
  GitHub auto-disables a scheduled workflow after 60 days with no commits
  to the repo — harmless here since the repo will keep getting pushes.

This checks Gmail only, with a keyword heuristic rather than full LLM
judgment (cheap and fast; less nuanced than the existing Daily Gmail Triage
automation). The other 21 templates keep their existing daily/weekly/monthly
cadence — those SOPs (delinquency, lease renewals, owner statements) don't
move fast enough to justify frequent Buildium scraping, and Buildium may not
tolerate a bot re-scraping it every few minutes anyway.

**Setup checklist (all one-time, and all need to happen outside this
session — this sandbox's network policy blocks Google Cloud Console and
Vercel, so none of this is something Claude can click through):**

1. **Google Cloud OAuth client** — in [Google Cloud Console](https://console.cloud.google.com):
   create a project (or use an existing one), enable the **Gmail API**, and
   create an **OAuth 2.0 Client ID** (type: Web application). Add
   `https://<your-deployed-domain>/api/auth/gmail/callback` as an
   authorized redirect URI. Note the Client ID and Client Secret.
2. **Vercel env vars** — in the project's Settings → Environment Variables,
   add:
   - `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET` — from step 1
   - `CRON_SECRET` — any random string you generate (e.g. `openssl rand -hex 32`)

   Redeploy after adding them (env var changes need a redeploy to take effect).
3. **One-time Gmail consent** — visit
   `https://<your-deployed-domain>/api/auth/gmail/start` yourself, signed
   into the Gmail account this dashboard should read (the main EZ
   Management inbox), and approve access. You only do this once; the
   refresh token it captures is stored in Postgres.
4. **GitHub Actions scheduler** — in this repo's Settings → Secrets and
   variables → Actions:
   - Add repo **variable** `DASHBOARD_URL` = `https://<your-deployed-domain>`
   - Add repo **secret** `CRON_SECRET` = the same value from step 2

   The workflow starts firing on the next scheduled tick after that (or
   trigger it immediately from the Actions tab → "Poll Gmail for urgent
   signals" → Run workflow).

Until all four are done, `/api/cron/gmail-check` just returns a 409 (Gmail
not connected) or the GitHub Action fails fast with a clear message — safe
either way, nothing breaks by deploying before finishing this checklist.

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
