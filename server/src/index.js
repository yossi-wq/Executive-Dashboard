import express from "express";
import cors from "cors";
import { db, todayStr, nowIso } from "./db.js";
import "./seed.js";
import { materializeToday } from "./materializer.js";

const PORT = process.env.PORT || 4000;
const app = express();
app.use(cors());
app.use(express.json());

// ---- SSE (live "pop up" updates) --------------------------------------
const sseClients = new Set();

function broadcast(event, data) {
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

function hydrateTask(t) {
  const assignees = db
    .prepare(
      `SELECT tm.id, tm.name, tm.color FROM task_assignees ta
       JOIN team_members tm ON tm.id = ta.member_id
       WHERE ta.task_id = ?`
    )
    .all(t.id);
  return { ...t, assignees };
}

// ---- Overview -------------------------------------------------------------
app.get("/api/overview", (req, res) => {
  const snapshot = db
    .prepare("SELECT * FROM kpi_snapshots ORDER BY snapshot_date DESC, id DESC LIMIT 1")
    .get();
  const today = todayStr();

  const openToday = db
    .prepare("SELECT COUNT(*) AS n FROM tasks WHERE due_date = ? AND status = 'open'")
    .get(today).n;
  const doneToday = db
    .prepare("SELECT COUNT(*) AS n FROM tasks WHERE due_date = ? AND status = 'done'")
    .get(today).n;
  const overdue = db
    .prepare("SELECT COUNT(*) AS n FROM tasks WHERE due_date < ? AND status = 'open'")
    .get(today).n;

  const byMember = db
    .prepare(
      `SELECT tm.id, tm.name, tm.color,
              SUM(CASE WHEN t.status = 'open' AND t.due_date <= ? THEN 1 ELSE 0 END) AS open_count,
              SUM(CASE WHEN t.status = 'done' AND t.due_date = ? THEN 1 ELSE 0 END) AS done_today
       FROM team_members tm
       LEFT JOIN task_assignees ta ON ta.member_id = tm.id
       LEFT JOIN tasks t ON t.id = ta.task_id
       WHERE tm.active = 1
       GROUP BY tm.id
       ORDER BY tm.sort_order`
    )
    .all(today, today);

  res.json({
    kpi: snapshot ? { ...snapshot, metrics: JSON.parse(snapshot.metrics_json) } : null,
    tasksToday: { open: openToday, done: doneToday, overdue },
    byMember,
    activeAutomations: db
      .prepare("SELECT COUNT(*) AS n FROM task_templates WHERE status = 'active'")
      .get().n,
  });
});

app.post("/api/kpi", (req, res) => {
  const { snapshot_date, metrics, note } = req.body || {};
  if (!snapshot_date || !metrics) {
    return res.status(400).json({ error: "snapshot_date and metrics are required" });
  }
  const result = db
    .prepare("INSERT INTO kpi_snapshots (snapshot_date, metrics_json, note) VALUES (?, ?, ?)")
    .run(snapshot_date, JSON.stringify(metrics), note || "");
  broadcast("overview_updated", { id: result.lastInsertRowid });
  res.status(201).json({ id: result.lastInsertRowid });
});

// ---- Team -----------------------------------------------------------------
app.get("/api/team", (req, res) => {
  const members = db.prepare("SELECT * FROM team_members ORDER BY sort_order, id").all();
  res.json(members.map(memberRow));
});

app.post("/api/team", (req, res) => {
  const { name, role = "", email = "", color = "#6366f1" } = req.body || {};
  if (!name) return res.status(400).json({ error: "name is required" });
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM team_members").get().m;
  const result = db
    .prepare("INSERT INTO team_members (name, role, email, color, sort_order) VALUES (?, ?, ?, ?, ?)")
    .run(name, role, email, color, maxOrder + 1);
  const member = db.prepare("SELECT * FROM team_members WHERE id = ?").get(result.lastInsertRowid);
  broadcast("team_updated", { id: member.id });
  res.status(201).json(memberRow(member));
});

app.patch("/api/team/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM team_members WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "not found" });
  const fields = ["name", "role", "email", "color", "active"];
  const next = { ...existing };
  for (const f of fields) if (req.body?.[f] !== undefined) next[f] = req.body[f];
  db.prepare(
    "UPDATE team_members SET name=?, role=?, email=?, color=?, active=? WHERE id=?"
  ).run(next.name, next.role, next.email, next.color, next.active ? 1 : 0, id);
  broadcast("team_updated", { id });
  res.json(memberRow(db.prepare("SELECT * FROM team_members WHERE id = ?").get(id)));
});

// ---- Tasks ------------------------------------------------------------------
app.get("/api/tasks", (req, res) => {
  const { date, status, member_id, scope } = req.query;
  let query = "SELECT * FROM tasks WHERE 1=1";
  const params = [];

  if (scope === "all") {
    // no date filter
  } else if (scope === "upcoming") {
    query += " AND due_date >= ?";
    params.push(todayStr());
  } else if (scope === "overdue") {
    query += " AND due_date < ? AND status = 'open'";
    params.push(todayStr());
  } else if (date) {
    query += " AND due_date = ?";
    params.push(date);
  } else {
    query += " AND due_date <= ?";
    params.push(todayStr());
  }

  if (status) {
    query += " AND status = ?";
    params.push(status);
  }
  query += " ORDER BY due_date DESC, id DESC";

  let tasks = db.prepare(query).all(...params).map(hydrateTask);

  if (member_id) {
    const mid = Number(member_id);
    tasks = tasks.filter((t) => t.assignees.some((a) => a.id === mid));
  }

  res.json(tasks);
});

function createTaskHandler(req, res) {
  const {
    title,
    description = "",
    category = "general",
    sop_ref = "",
    priority = "normal",
    due_date = todayStr(),
    assignee_ids = [],
    assignee_names = [],
    source = "manual",
  } = req.body || {};

  if (!title) return res.status(400).json({ error: "title is required" });

  let resolvedAssigneeIds = [...assignee_ids];
  if (assignee_names.length) {
    const findByName = db.prepare("SELECT id FROM team_members WHERE name = ?");
    for (const name of assignee_names) {
      const row = findByName.get(name);
      if (row) resolvedAssigneeIds.push(row.id);
    }
  }

  const result = db
    .prepare(
      `INSERT INTO tasks (title, description, category, sop_ref, priority, due_date, status, source)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`
    )
    .run(title, description, category, sop_ref, priority, due_date, source);

  const insertAssignee = db.prepare("INSERT INTO task_assignees (task_id, member_id) VALUES (?, ?)");
  for (const id of new Set(resolvedAssigneeIds)) insertAssignee.run(result.lastInsertRowid, id);

  const task = hydrateTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(result.lastInsertRowid));
  broadcast("task_created", task);
  res.status(201).json(task);
}

app.post("/api/tasks", createTaskHandler);

app.patch("/api/tasks/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "not found" });

  const { status, completed_by, title, description, priority, due_date } = req.body || {};
  const next = { ...existing };
  if (title !== undefined) next.title = title;
  if (description !== undefined) next.description = description;
  if (priority !== undefined) next.priority = priority;
  if (due_date !== undefined) next.due_date = due_date;
  if (status !== undefined) next.status = status;

  const completedAt = status === "done" ? nowIso() : status === "open" ? null : existing.completed_at;
  const completedBy = status === "done" ? completed_by || null : status === "open" ? null : existing.completed_by;

  db.prepare(
    `UPDATE tasks SET title=?, description=?, priority=?, due_date=?, status=?, completed_at=?, completed_by=?
     WHERE id=?`
  ).run(next.title, next.description, next.priority, next.due_date, next.status, completedAt, completedBy, id);

  const task = hydrateTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(id));
  broadcast("task_updated", task);
  res.json(task);
});

app.delete("/api/tasks/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  broadcast("task_deleted", { id });
  res.status(204).end();
});

// ---- Templates (recurring automations) -------------------------------------
app.get("/api/templates", (req, res) => {
  const templates = db.prepare("SELECT * FROM task_templates ORDER BY id").all();
  const getAssignees = db.prepare(
    `SELECT tm.id, tm.name FROM template_assignees ta
     JOIN team_members tm ON tm.id = ta.member_id WHERE ta.template_id = ?`
  );
  res.json(templates.map((t) => ({ ...t, assignees: getAssignees.all(t.id) })));
});

app.patch("/api/templates/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM task_templates WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "not found" });
  const { status } = req.body || {};
  if (status) db.prepare("UPDATE task_templates SET status = ? WHERE id = ?").run(status, id);
  broadcast("template_updated", { id });
  res.json(db.prepare("SELECT * FROM task_templates WHERE id = ?").get(id));
});

// ---- Ingestion webhook for external automations ----------------------------
// A Cowork routine (or any script) can POST here to push a fresh task onto
// the board the moment it finds something — this is what makes "new tasks
// pop up" work for automations beyond the ones seeded at setup time.
app.post("/api/ingest", createTaskHandler);

// ---- boot -------------------------------------------------------------------
const created = materializeToday(broadcast);
console.log(`Materialized ${created} task(s) for ${todayStr()}.`);

// Re-check once an hour in case the process stays up across midnight.
setInterval(() => materializeToday(broadcast), 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Executive Dashboard API listening on :${PORT}`);
});
