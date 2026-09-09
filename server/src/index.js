import { app, ready, broadcast } from "./app.js";
import { materializeToday } from "./materializer.js";
import { todayStr } from "./db.js";

const PORT = process.env.PORT || 4000;

await ready();

// Re-check once an hour in case the process stays up across midnight.
// (Only meaningful for a long-running host — a no-op concern on serverless.)
setInterval(async () => {
  const created = await materializeToday(broadcast);
  if (created) console.log(`Materialized ${created} task(s) for ${todayStr()}.`);
}, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Executive Dashboard API listening on :${PORT}`);
});
