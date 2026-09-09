import TaskCard from "./TaskCard.jsx";
import { initials } from "../format.js";

export default function TeamBoard({ team, tasks, recentIds, onToggle, onDelete, onAddFor }) {
  return (
    <div className="team-board">
      {team.map((member) => {
        const memberTasks = tasks
          .filter((t) => t.assignees.some((a) => a.id === member.id))
          .sort((a, b) => (a.status === b.status ? b.id - a.id : a.status === "done" ? 1 : -1));
        const openCount = memberTasks.filter((t) => t.status === "open").length;

        return (
          <div className="team-column" key={member.id}>
            <div className="team-column-head">
              <div className="avatar" style={{ background: member.color }}>
                {initials(member.name)}
              </div>
              <div className="team-column-title">
                <div className="team-name">{member.name}</div>
                <div className="team-role">{member.role}</div>
              </div>
              <div className="team-count" title="open tasks">
                {openCount}
              </div>
            </div>

            {memberTasks.length === 0 ? (
              <div className="empty-column">All clear 🎉</div>
            ) : (
              <ul className="task-list">
                {memberTasks.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    onToggle={onToggle}
                    onDelete={onDelete}
                    highlight={recentIds.has(t.id)}
                  />
                ))}
              </ul>
            )}

            <button className="add-for-member" onClick={() => onAddFor(member)}>
              + Add task for {member.name.split(" ")[0]}
            </button>
          </div>
        );
      })}
    </div>
  );
}
