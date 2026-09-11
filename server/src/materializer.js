import { query, todayStr } from "./db.js";
import { cronFiresOn } from "./cronMatch.js";

// Turns each active recurring template that fires "today" into a concrete
// task instance for that date, unless one already exists (unique index on
// template_id + due_date makes this idempotent).
export async function materializeToday(emit) {
  const today = new Date();
  const dateStr = todayStr(today);

  const { rows: templates } = await query(
    "SELECT * FROM task_templates WHERE status = 'active'"
  );

  let created = 0;
  for (const t of templates) {
    if (!cronFiresOn(t.cron_expr, today)) continue;

    const { rows: existing } = await query(
      "SELECT 1 FROM tasks WHERE template_id = $1 AND due_date = $2",
      [t.id, dateStr]
    );
    if (existing.length) continue;

    const { rows: assigneeRows } = await query(
      "SELECT member_id FROM template_assignees WHERE template_id = $1",
      [t.id]
    );

    const { rows: inserted } = await query(
      `INSERT INTO tasks (template_id, title, description, category, sop_ref, due_date, status, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', 'automation') RETURNING id`,
      [t.id, t.title, t.description, t.category, t.sop_ref, dateStr]
    );
    const taskId = inserted[0].id;

    for (const row of assigneeRows) {
      await query("INSERT INTO task_assignees (task_id, member_id) VALUES ($1, $2)", [
        taskId,
        row.member_id,
      ]);
    }

    created += 1;
    if (emit) emit("task_created", { id: taskId, title: t.title, due_date: dateStr });
  }
  return created;
}
