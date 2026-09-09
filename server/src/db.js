import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "dashboard.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  email TEXT DEFAULT '',
  color TEXT NOT NULL DEFAULT '#6366f1',
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  cadence_label TEXT NOT NULL DEFAULT '',
  cron_expr TEXT NOT NULL DEFAULT '',
  sop_ref TEXT DEFAULT '',
  source TEXT NOT NULL DEFAULT 'automation',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS template_assignees (
  template_id INTEGER NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, member_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER REFERENCES task_templates(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  sop_ref TEXT DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal',
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  completed_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_template_due
  ON tasks(template_id, due_date) WHERE template_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_task_assignees_member ON task_assignees(member_id);

CREATE TABLE IF NOT EXISTS kpi_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export function nowIso() {
  return new Date().toISOString();
}

export function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
