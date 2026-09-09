import { useEffect, useMemo, useRef, useState } from "react";
import { api, subscribe } from "./api.js";
import OverviewBar from "./components/OverviewBar.jsx";
import TeamBoard from "./components/TeamBoard.jsx";
import AddTaskModal from "./components/AddTaskModal.jsx";
import Toast from "./components/Toast.jsx";
import { CATEGORY_LABEL } from "./format.js";

const SCOPES = [
  { key: "today", label: "Today" },
  { key: "overdue", label: "Overdue" },
  { key: "upcoming", label: "Upcoming" },
  { key: "all", label: "All open" },
];

export default function App() {
  const [overview, setOverview] = useState(null);
  const [team, setTeam] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [scope, setScope] = useState("today");
  const [tab, setTab] = useState("board");
  const [templates, setTemplates] = useState([]);
  const [modal, setModal] = useState(null); // { defaultAssigneeId } | null
  const [toasts, setToasts] = useState([]);
  const [recentIds, setRecentIds] = useState(new Set());
  const [connected, setConnected] = useState(false);
  const toastTimer = useRef({});

  async function loadOverview() {
    setOverview(await api.getOverview());
  }
  async function loadTeam() {
    setTeam(await api.getTeam());
  }
  async function loadTasks(currentScope = scope) {
    if (currentScope === "today") {
      setTasks(await api.getTasks({ date: new Date().toISOString().slice(0, 10) }));
    } else if (currentScope === "all") {
      setTasks(await api.getTasks({ scope: "all", status: "open" }));
    } else {
      setTasks(await api.getTasks({ scope: currentScope }));
    }
  }
  async function loadTemplates() {
    setTemplates(await api.getTemplates());
  }

  useEffect(() => {
    loadOverview();
    loadTeam();
    loadTemplates();
  }, []);

  useEffect(() => {
    loadTasks(scope);
  }, [scope]);

  function pushToast(message, id) {
    const toastId = `${Date.now()}-${Math.random()}`;
    setToasts((t) => [...t, { id: toastId, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== toastId)), 5000);
    if (id != null) {
      setRecentIds((s) => new Set(s).add(id));
      clearTimeout(toastTimer.current[id]);
      toastTimer.current[id] = setTimeout(() => {
        setRecentIds((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }, 4000);
    }
  }

  useEffect(() => {
    const unsubscribe = subscribe((event, data) => {
      if (event === "connected") {
        setConnected(true);
        return;
      }
      if (event === "disconnected") {
        setConnected(false);
        return;
      }
      setConnected(true);
      if (event === "task_created") {
        pushToast(`🔔 New task: ${data.title}`, data.id);
        loadTasks();
        loadOverview();
      } else if (event === "task_updated") {
        loadTasks();
        loadOverview();
      } else if (event === "task_deleted") {
        loadTasks();
        loadOverview();
      } else if (event === "overview_updated") {
        loadOverview();
      } else if (event === "team_updated") {
        loadTeam();
      } else if (event === "template_updated") {
        loadTemplates();
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  async function handleToggle(task) {
    const nextStatus = task.status === "done" ? "open" : "done";
    setTasks((cur) => cur.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)));
    try {
      await api.updateTask(task.id, { status: nextStatus, completed_by: "you" });
    } finally {
      loadTasks();
      loadOverview();
    }
  }

  async function handleDelete(task) {
    if (!confirm(`Remove "${task.title}"?`)) return;
    setTasks((cur) => cur.filter((t) => t.id !== task.id));
    try {
      await api.deleteTask(task.id);
    } finally {
      loadTasks();
      loadOverview();
    }
  }

  async function handleCreate(data) {
    await api.addTask(data);
    loadTasks();
    loadOverview();
  }

  async function handleTemplateToggle(t) {
    await api.updateTemplate(t.id, { status: t.status === "active" ? "paused" : "active" });
    loadTemplates();
  }

  const visibleTasks = useMemo(() => tasks, [tasks]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>EZ Management</h1>
          <p className="app-subtitle">Operations dashboard — property management</p>
        </div>
        <div className="app-header-right">
          <span className={`live-dot ${connected ? "on" : ""}`} />
          <span className="live-label">{connected ? "Live" : "Connecting…"}</span>
          <button className="btn-primary" onClick={() => setModal({ defaultAssigneeId: null })}>
            + Add task
          </button>
        </div>
      </header>

      <main className="app-main">
        <OverviewBar overview={overview} />

        <div className="tab-row">
          <button className={`tab ${tab === "board" ? "active" : ""}`} onClick={() => setTab("board")}>
            Team board
          </button>
          <button className={`tab ${tab === "automations" ? "active" : ""}`} onClick={() => setTab("automations")}>
            Automations ({templates.filter((t) => t.status === "active").length})
          </button>
        </div>

        {tab === "board" && (
          <>
            <div className="scope-row">
              {SCOPES.map((s) => (
                <button key={s.key} className={`scope-pill ${scope === s.key ? "active" : ""}`} onClick={() => setScope(s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
            <TeamBoard
              team={team}
              tasks={visibleTasks}
              recentIds={recentIds}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onAddFor={(member) => setModal({ defaultAssigneeId: member.id })}
            />
          </>
        )}

        {tab === "automations" && (
          <div className="automation-list">
            <p className="automation-intro">
              These are the recurring Claude Cowork automations configured for EZ Management. Each fires on its own
              schedule and creates the matching task on the board above — pause one here if it shouldn't post tasks
              for a while.
            </p>
            <table className="automation-table">
              <thead>
                <tr>
                  <th>Automation</th>
                  <th>Category</th>
                  <th>Cadence</th>
                  <th>SOP</th>
                  <th>Assigned to</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className={t.status !== "active" ? "paused-row" : ""}>
                    <td className="automation-title" title={t.description}>{t.title}</td>
                    <td>{CATEGORY_LABEL[t.category] || t.category}</td>
                    <td>{t.cadence_label}</td>
                    <td>{t.sop_ref || "—"}</td>
                    <td>{t.assignees.map((a) => a.name).join(", ")}</td>
                    <td>
                      <button className={`status-toggle ${t.status}`} onClick={() => handleTemplateToggle(t)}>
                        {t.status === "active" ? "Active" : "Paused"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {modal && (
        <AddTaskModal
          team={team}
          defaultAssigneeId={modal.defaultAssigneeId}
          onClose={() => setModal(null)}
          onCreate={handleCreate}
        />
      )}

      <Toast toasts={toasts} />
    </div>
  );
}
