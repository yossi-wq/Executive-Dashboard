import express from "express";
import cors from "cors";
import { query, ensureSchema, todayStr } from "./db.js";
import { seed } from "./seed.js";
import { materializeToday } from "./materializer.js";
import * as gmail from "./gmail.js";

export const app = express();
app.use(cors());
app.use(express.json());

// ---- SSE (live "pop up" updates) --------------------------------------
// Works when the process stays alive (local dev, or a long-running host
// like Render/Fly/a VPS). On a serverless host (Vercel) each request runs
// in its own short-lived invocation, so a held-open stream doesn't persist
// across requests — clients there fall back to periodic polling instead.
const sseClients = new Set();

export function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

app.get("/api/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  res.write("retry: 3000\n\n");
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

// ---- helpers ------------------------------------------------------------
function memberRow(m) {
  return { id: m.id, name: m.name, role: m.role, email: m.email, color: m.color, active: !!m.active };
}

async function hydrateTask(t) {
  const { rows: assignees } = await query(
    `SELECT tm.id, tm.name, tm.color FROM task_assignees ta
     JOIN team_members tm ON tm.id = ta.member_id
     WHERE ta.task_id = $1`,
    [t.id]
  );
  return { ...t, assignees };
}

// Lazily runs schema+seed+materialize once per warm process (cold start on
// serverless, once at boot for a long-running server).
let readyPromise = null;
export function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await ensureSchema();
      await seed();
      const created = await materializeToday(broadcast);
      console.log(`Materialized ${created} task(s) for ${todayStr()}.`);
    })();
  }
  return readyPromise;
}

app.use(async (req, res, next) => {
  try {
    await ready();
    next();
  } catch (err) {
    next(err);
  }
});

// ---- Overview -------------------------------------------------------------
app.get("/api/overview", async (req, res, next) => {
  try {
    const { rows: snapshotRows } = await query(
      "SELECT * FROM kpi_snapshots ORDER BY snapshot_date DESC, id DESC LIMIT 1"
    );
    const snapshot = snapshotRows[0];
    const today = todayStr();

    const { rows: openRows } = await query(
      "SELECT COUNT(*) AS n FROM tasks WHERE due_date = $1 AND status = 'open'",
      [today]
    );
    const { rows: doneRows } = await query(
      "SELECT COUNT(*) AS n FROM tasks WHERE due_date = $1 AND status = 'done'",
      [today]
    );
    const { rows: overdueRows } = await query(
      "SELECT COUNT(*) AS n FROM tasks WHERE due_date < $1 AND status = 'open'",
      [today]
    );

    const { rows: byMember } = await query(
      `SELECT tm.id, tm.name, tm.color,
              SUM(CASE WHEN t.status = 'open' AND t.due_date <= $1 THEN 1 ELSE 0 END) AS open_count,
              SUM(CASE WHEN t.status = 'done' AND t.due_date = $1 THEN 1 ELSE 0 END) AS done_today
       FROM team_members tm
       LEFT JOIN task_assignees ta ON ta.member_id = tm.id
       LEFT JOIN tasks t ON t.id = ta.task_id
       WHERE tm.active = TRUE
       GROUP BY tm.id
       ORDER BY tm.sort_order`,
      [today]
    );

    const { rows: automationRows } = await query(
      "SELECT COUNT(*) AS n FROM task_templates WHERE status = 'active'"
    );

    res.json({
      kpi: snapshot || null,
      tasksToday: {
        open: Number(openRows[0].n),
        done: Number(doneRows[0].n),
        overdue: Number(overdueRows[0].n),
      },
      byMember: byMember.map((r) => ({
        ...r,
        open_count: Number(r.open_count),
        done_today: Number(r.done_today),
      })),
      activeAutomations: Number(automationRows[0].n),
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/kpi", async (req, res, next) => {
  try {
    const { snapshot_date, metrics, note } = req.body || {};
    if (!snapshot_date || !metrics) {
      return res.status(400).json({ error: "snapshot_date and metrics are required" });
    }
    const { rows } = await query(
      "INSERT INTO kpi_snapshots (snapshot_date, metrics, note) VALUES ($1, $2, $3) RETURNING id",
      [snapshot_date, JSON.stringify(metrics), note || ""]
    );
    broadcast("overview_updated", { id: rows[0].id });
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    next(err);
  }
});

// ---- Team -----------------------------------------------------------------
app.get("/api/team", async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM team_members ORDER BY sort_order, id");
    res.json(rows.map(memberRow));
  } catch (err) {
    next(err);
  }
});

app.post("/api/team", async (req, res, next) => {
  try {
    const { name, role = "", email = "", color = "#6366f1" } = req.body || {};
    if (!name) return res.status(400).json({ error: "name is required" });
    const { rows: maxRows } = await query("SELECT COALESCE(MAX(sort_order), -1) AS m FROM team_members");
    const { rows } = await query(
      "INSERT INTO team_members (name, role, email, color, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [name, role, email, color, Number(maxRows[0].m) + 1]
    );
    broadcast("team_updated", { id: rows[0].id });
    res.status(201).json(memberRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

app.patch("/api/team/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: existingRows } = await query("SELECT * FROM team_members WHERE id = $1", [id]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: "not found" });

    const fields = ["name", "role", "email", "color", "active"];
    const next_ = { ...existing };
    for (const f of fields) if (req.body?.[f] !== undefined) next_[f] = req.body[f];

    await query(
      "UPDATE team_members SET name=$1, role=$2, email=$3, color=$4, active=$5 WHERE id=$6",
      [next_.name, next_.role, next_.email, next_.color, !!next_.active, id]
    );
    broadcast("team_updated", { id });
    const { rows } = await query("SELECT * FROM team_members WHERE id = $1", [id]);
    res.json(memberRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

// ---- Tasks ------------------------------------------------------------------
app.get("/api/tasks", async (req, res, next) => {
  try {
    const { date, status, member_id, scope } = req.query;
    let sql = "SELECT * FROM tasks WHERE 1=1";
    const params = [];

    if (scope === "all") {
      // no date filter
    } else if (scope === "upcoming") {
      params.push(todayStr());
      sql += ` AND due_date >= $${params.length}`;
    } else if (scope === "overdue") {
      params.push(todayStr());
      sql += ` AND due_date < $${params.length} AND status = 'open'`;
    } else if (date) {
      params.push(date);
      sql += ` AND due_date = $${params.length}`;
    } else {
      params.push(todayStr());
      sql += ` AND due_date <= $${params.length}`;
    }

    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }
    sql += " ORDER BY due_date DESC, id DESC";

    const { rows } = await query(sql, params);
    let tasks = await Promise.all(rows.map(hydrateTask));

    if (member_id) {
      const mid = Number(member_id);
      tasks = tasks.filter((t) => t.assignees.some((a) => a.id === mid));
    }

    res.json(tasks);
  } catch (err) {
    next(err);
  }
});

async function createTask({
  title,
  description = "",
  category = "general",
  sop_ref = "",
  priority = "normal",
  due_date = todayStr(),
  assignee_ids = [],
  assignee_names = [],
  source = "manual",
}) {
  if (!title) throw Object.assign(new Error("title is required"), { status: 400 });

  let resolvedAssigneeIds = [...assignee_ids];
  if (assignee_names.length) {
    for (const name of assignee_names) {
      const { rows } = await query("SELECT id FROM team_members WHERE name = $1", [name]);
      if (rows.length) resolvedAssigneeIds.push(rows[0].id);
    }
  }

  const { rows: inserted } = await query(
    `INSERT INTO tasks (title, description, category, sop_ref, priority, due_date, status, source)
     VALUES ($1, $2, $3, $4, $5, $6, 'open', $7) RETURNING id`,
    [title, description, category, sop_ref, priority, due_date, source]
  );
  const taskId = inserted[0].id;

  for (const memberId of new Set(resolvedAssigneeIds)) {
    await query("INSERT INTO task_assignees (task_id, member_id) VALUES ($1, $2)", [taskId, memberId]);
  }

  const { rows: taskRows } = await query("SELECT * FROM tasks WHERE id = $1", [taskId]);
  const task = await hydrateTask(taskRows[0]);
  broadcast("task_created", task);
  return task;
}

async function createTaskHandler(req, res, next) {
  try {
    const task = await createTask(req.body || {});
    res.status(201).json(task);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

app.post("/api/tasks", createTaskHandler);

app.patch("/api/tasks/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: existingRows } = await query("SELECT * FROM tasks WHERE id = $1", [id]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: "not found" });

    const { status, completed_by, title, description, priority, due_date } = req.body || {};
    const next_ = { ...existing };
    if (title !== undefined) next_.title = title;
    if (description !== undefined) next_.description = description;
    if (priority !== undefined) next_.priority = priority;
    if (due_date !== undefined) next_.due_date = due_date;
    if (status !== undefined) next_.status = status;

    const completedAt = status === "done" ? new Date() : status === "open" ? null : existing.completed_at;
    const completedBy =
      status === "done" ? completed_by || null : status === "open" ? null : existing.completed_by;

    await query(
      `UPDATE tasks SET title=$1, description=$2, priority=$3, due_date=$4, status=$5, completed_at=$6, completed_by=$7
       WHERE id=$8`,
      [next_.title, next_.description, next_.priority, next_.due_date, next_.status, completedAt, completedBy, id]
    );

    const { rows: taskRows } = await query("SELECT * FROM tasks WHERE id = $1", [id]);
    const task = await hydrateTask(taskRows[0]);
    broadcast("task_updated", task);
    res.json(task);
  } catch (err) {
    next(err);
  }
});

app.delete("/api/tasks/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await query("DELETE FROM tasks WHERE id = $1", [id]);
    broadcast("task_deleted", { id });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Templates (recurring automations) -------------------------------------
app.get("/api/templates", async (req, res, next) => {
  try {
    const { rows: templates } = await query("SELECT * FROM task_templates ORDER BY id");
    const withAssignees = await Promise.all(
      templates.map(async (t) => {
        const { rows: assignees } = await query(
          `SELECT tm.id, tm.name FROM template_assignees ta
           JOIN team_members tm ON tm.id = ta.member_id WHERE ta.template_id = $1`,
          [t.id]
        );
        return { ...t, assignees };
      })
    );
    res.json(withAssignees);
  } catch (err) {
    next(err);
  }
});

app.patch("/api/templates/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: existingRows } = await query("SELECT * FROM task_templates WHERE id = $1", [id]);
    if (!existingRows.length) return res.status(404).json({ error: "not found" });
    const { status } = req.body || {};
    if (status) await query("UPDATE task_templates SET status = $1 WHERE id = $2", [status, id]);
    broadcast("template_updated", { id });
    const { rows } = await query("SELECT * FROM task_templates WHERE id = $1", [id]);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ---- Ingestion webhook for external automations ----------------------------
// A Cowork routine (or any script) can POST here to push a fresh task onto
// the board the moment it finds something — this is what makes "new tasks
// pop up" work for automations beyond the ones seeded at setup time.
app.post("/api/ingest", createTaskHandler);

// ---- Gmail: fast-signal polling built into the app itself -----------------
// Cowork Routines on this account can't fire more often than hourly and
// (separately) can't be granted connector access via this API — so this
// gets its own direct Gmail OAuth connection instead, polled by an external
// scheduler (see .github/workflows/gmail-poll.yml) that can run every few
// minutes with no such limits.

function redirectUriFor(req) {
  return `${req.protocol}://${req.get("host")}/api/auth/gmail/callback`;
}

app.get("/api/auth/gmail/status", async (req, res, next) => {
  try {
    res.json({ connected: await gmail.isConnected() });
  } catch (err) {
    next(err);
  }
});

// Visit this once, signed into the Gmail account this dashboard should
// read, to grant read-only access. Nothing else in the app needs this —
// only /api/cron/gmail-check.
app.get("/api/auth/gmail/start", (req, res, next) => {
  try {
    res.redirect(gmail.buildAuthUrl(redirectUriFor(req)));
  } catch (err) {
    next(err);
  }
});

app.get("/api/auth/gmail/callback", async (req, res, next) => {
  try {
    const { code, error } = req.query;
    if (error) return res.status(400).send(`Gmail authorization failed: ${error}`);
    if (!code) return res.status(400).send("Missing authorization code");

    const tokens = await gmail.exchangeCodeForTokens(code, redirectUriFor(req));
    if (!tokens.refresh_token) {
      return res
        .status(400)
        .send(
          "Google didn't return a refresh token (it only does on first consent). " +
            "Remove this app's access at myaccount.google.com/permissions and try /api/auth/gmail/start again."
        );
    }
    await gmail.saveRefreshToken(tokens.refresh_token);
    res.send("Gmail connected. This dashboard can now check for new mail. You can close this tab.");
  } catch (err) {
    next(err);
  }
});

// Called by an external scheduler (GitHub Actions — see
// .github/workflows/gmail-poll.yml), not by users. Requires a shared
// secret so nobody else can trigger it or discover whether Gmail is wired
// up. Judges urgency with a keyword heuristic, not full LLM judgment —
// good enough as a fast net between the fuller daily Gmail triage.
app.post("/api/cron/gmail-check", async (req, res, next) => {
  try {
    const expected = process.env.CRON_SECRET;
    if (!expected || req.get("x-cron-secret") !== expected) {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (!(await gmail.isConnected())) {
      return res.status(409).json({ error: "gmail not connected — visit /api/auth/gmail/start" });
    }

    const { rows: openTasks } = await query(
      "SELECT title, description FROM tasks WHERE status = 'open'"
    );
    const existingText = openTasks.map((t) => `${t.title} ${t.description}`.toLowerCase()).join("\n");

    const messages = await gmail.listRecentUnread(75);
    const created = [];
    for (const msg of messages) {
      const verdict = gmail.judgeUrgency(msg);
      if (!verdict) continue;
      const alreadyTracked = existingText.includes(msg.subject.toLowerCase().slice(0, 30));
      if (alreadyTracked) continue;

      const task = await createTask({
        title: `Urgent email: ${msg.subject || "(no subject)"}`,
        description: `From ${msg.from}: ${msg.snippet}`,
        category: verdict.category,
        assignee_names: ["Yossi Myers"],
        source: "automation",
      });
      created.push(task.id);
    }
    res.json({ checked: messages.length, created: created.length, task_ids: created });
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal error" });
});
