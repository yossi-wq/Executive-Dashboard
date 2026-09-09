const BASE = "/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  getOverview: () => request("/overview"),
  getTeam: () => request("/team"),
  addMember: (data) => request("/team", { method: "POST", body: JSON.stringify(data) }),
  updateMember: (id, data) => request(`/team/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  getTasks: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/tasks${qs ? `?${qs}` : ""}`);
  },
  addTask: (data) => request("/tasks", { method: "POST", body: JSON.stringify(data) }),
  updateTask: (id, data) => request(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: "DELETE" }),
  getTemplates: () => request("/templates"),
  updateTemplate: (id, data) => request(`/templates/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
};

export function subscribe(onEvent) {
  const source = new EventSource(`${BASE}/stream`);
  source.addEventListener("open", () => onEvent("connected", null));
  source.addEventListener("error", () => onEvent("disconnected", null));
  const events = ["task_created", "task_updated", "task_deleted", "overview_updated", "team_updated", "template_updated"];
  events.forEach((name) => {
    source.addEventListener(name, (e) => {
      onEvent(name, e.data ? JSON.parse(e.data) : null);
    });
  });
  return () => source.close();
}
