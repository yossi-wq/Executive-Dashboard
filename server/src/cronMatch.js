// Minimal day-level matcher for standard 5-field cron ("min hour dom mon dow").
// We only care whether a template fires on a given calendar date, so only the
// day-of-month, month, and day-of-week fields are evaluated.

function fieldMatches(field, value, max) {
  if (field === "*") return true;
  return field.split(",").some((part) => {
    if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      return value >= a && value <= b;
    }
    if (part.includes("/")) {
      const [base, step] = part.split("/");
      const start = base === "*" ? 0 : Number(base);
      return (value - start) % Number(step) === 0 && value >= start;
    }
    return Number(part) === value;
  });
}

export function cronFiresOn(cronExpr, date) {
  if (!cronExpr || !cronExpr.trim()) return false;
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [, , dom, mon, dow] = parts;

  const dayOfMonth = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const dayOfWeek = date.getUTCDay(); // 0 = Sunday

  const domMatch = dom === "*" || fieldMatches(dom, dayOfMonth, 31);
  const monMatch = mon === "*" || fieldMatches(mon, month, 12);
  const dowMatch = dow === "*" || fieldMatches(dow, dayOfWeek, 6);

  // Standard cron OR-semantics when both DOM and DOW are restricted.
  if (dom !== "*" && dow !== "*") {
    return monMatch && (domMatch || dowMatch);
  }
  return domMatch && monMatch && dowMatch;
}
