import { db, todayStr } from "./db.js";
import { cronFiresOn } from "./cronMatch.js";

// Turns each active recurring template that fires "today" into a concrete
// task instance for that date, unless one already exists (unique index on
// template_id + due_date makes this idempotent).
export function materializeToday(emit) {
  const today = new Date();
  const dateStr = todayStr(today);

  const templates = db
    .prepare("SELECT * FROM task_templates WHERE status = 'active'")
    .all();

  const insertTask = db.prepare(
    `INSERT INTO tasks (template_id, title, description, category, sop_ref, due_date, status, source)
     VALUES (?, ?, ?, ?, ?, ?, 'open', 'automation')`
  );
  const getAssignees = db.prepare(
    "SELECT member_id FROM template_assignees WHERE template_id = ?"
  );
  const insertTaskAssignee = db.prepare(
    "INSERT INTO task_assignees (task_id, member_id) VALUES (?, ?)"
  );
  const exists = db.prepare(
    "SELECT 1 FROM tasks WHERE template_id = ? AND due_date = ?"
  );

  let created = 0;
  for (const t of templates) {
    if (!cronFiresOn(t.cron_expr, today)) continue;
    if (exists.get(t.id, dateStr)) continue;

    const assignees = getAssignees.all(t.id).map((r) => r.member_id);
    const result = insertTask.run(
      t.id,
      t.title,
      t.description,
      t.category,
      t.sop_ref,
      dateStr
    );
    for (const memberId of assignees) {
      insertTaskAssignee.run(result.lastInsertRowid, memberId);
    }
    created += 1;
    if (emit) {
      emit("task_created", {
        id: result.lastInsertRowid,
        title: t.title,
        due_date: dateStr,
      });
    }
  }
  return created;
}
