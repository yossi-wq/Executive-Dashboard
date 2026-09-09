import pg from "pg";

// Keep DATE columns as plain "YYYY-MM-DD" strings (pg's default parser turns
// them into JS Date objects, which JSON.stringify renders as full
// timestamps — breaking the frontend's due_date === "YYYY-MM-DD" checks).
pg.types.setTypeParser(1082, (val) => val);

const connectionString =
  process.env.POSTGRES_URL || process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/exec_dashboard";

// Vercel Postgres (and most managed providers) require SSL outside local dev.
const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);

export const pool = new pg.Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

export async function query(text, params) {
  return pool.query(text, params);
}

let schemaReady = null;

export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS team_members (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT '',
        email TEXT DEFAULT '',
        color TEXT NOT NULL DEFAULT '#6366f1',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS task_templates (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'general',
        cadence_label TEXT NOT NULL DEFAULT '',
        cron_expr TEXT NOT NULL DEFAULT '',
        sop_ref TEXT DEFAULT '',
        source TEXT NOT NULL DEFAULT 'automation',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS template_assignees (
        template_id INTEGER NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
        member_id INTEGER NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
        PRIMARY KEY (template_id, member_id)
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        template_id INTEGER REFERENCES task_templates(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'general',
        sop_ref TEXT DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'normal',
        due_date DATE NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
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
        id SERIAL PRIMARY KEY,
        snapshot_date DATE NOT NULL,
        metrics JSONB NOT NULL,
        note TEXT DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }
  return schemaReady;
}

export function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
