import { useState } from "react";

const CATEGORIES = ["general", "accounting", "maintenance", "leasing", "compliance", "ops"];

export default function AddTaskModal({ team, defaultAssigneeId, onClose, onCreate }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("general");
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [assigneeIds, setAssigneeIds] = useState(defaultAssigneeId ? [defaultAssigneeId] : []);
  const [sopRef, setSopRef] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function toggleAssignee(id) {
    setAssigneeIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim(),
        category,
        due_date: dueDate,
        assignee_ids: assigneeIds,
        sop_ref: sopRef.trim(),
        source: "manual",
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h3>New task</h3>

        <label className="field">
          <span>Title</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Follow up on 62 Coleman water leak" required />
        </label>

        <label className="field">
          <span>Details</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Optional context" />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c[0].toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Due date</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <label className="field">
            <span>SOP ref (optional)</span>
            <input value={sopRef} onChange={(e) => setSopRef(e.target.value)} placeholder="SOP-XXX-00" />
          </label>
        </div>

        <div className="field">
          <span>Assign to</span>
          <div className="assignee-picker">
            {team.map((m) => (
              <button
                type="button"
                key={m.id}
                className={`chip ${assigneeIds.includes(m.id) ? "selected" : ""}`}
                style={assigneeIds.includes(m.id) ? { background: m.color, color: "#fff", borderColor: m.color } : undefined}
                onClick={() => toggleAssignee(m.id)}
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? "Adding…" : "Add task"}
          </button>
        </div>
      </form>
    </div>
  );
}
