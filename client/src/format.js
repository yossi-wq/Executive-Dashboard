export const money = (n) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;

export const pct = (n) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

export const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");

export const CATEGORY_LABEL = {
  accounting: "Accounting",
  maintenance: "Maintenance",
  leasing: "Leasing",
  compliance: "Compliance",
  ops: "Operations",
  general: "General",
};

export function formatDueDate(dateStr) {
  const today = new Date().toISOString().slice(0, 10);
  if (dateStr === today) return "Today";
  const d = new Date(dateStr + "T00:00:00Z");
  const t = new Date(today + "T00:00:00Z");
  const diffDays = Math.round((d - t) / 86400000);
  if (diffDays === -1) return "Yesterday";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays < 0) return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} (overdue)`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
