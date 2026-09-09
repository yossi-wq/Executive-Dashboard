import { CATEGORY_LABEL, formatDueDate } from "../format.js";

export default function TaskCard({ task, onToggle, onDelete, highlight }) {
  const done = task.status === "done";
  return (
    <li className={`task-card ${done ? "done" : ""} ${highlight ? "pop" : ""}`}>
      <label className="task-check">
        <input type="checkbox" checked={done} onChange={() => onToggle(task)} />
        <span className="checkmark" />
      </label>
      <div className="task-body">
        <div className="task-title-row">
          <span className="task-title">{task.title}</span>
          <span className={`task-badge cat-${task.category}`}>{CATEGORY_LABEL[task.category] || task.category}</span>
        </div>
        {task.description && <p className="task-desc">{task.description}</p>}
        <div className="task-meta">
          <span className={`task-due ${task.due_date < new Date().toISOString().slice(0, 10) && !done ? "overdue" : ""}`}>
            {formatDueDate(task.due_date)}
          </span>
          {task.sop_ref && <span className="task-sop">{task.sop_ref}</span>}
          {task.source === "manual" && <span className="task-source">manual</span>}
          {task.assignees?.length > 1 && (
            <span className="task-shared">shared with {task.assignees.map((a) => a.name.split(" ")[0]).join(", ")}</span>
          )}
        </div>
      </div>
      <button className="task-delete" title="Remove" onClick={() => onDelete(task)}>
        ×
      </button>
    </li>
  );
}
