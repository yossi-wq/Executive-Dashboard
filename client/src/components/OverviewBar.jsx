import { money, pct } from "../format.js";

function Tile({ label, value, sub, tone = "neutral" }) {
  return (
    <div className={`kpi-tile tone-${tone}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export default function OverviewBar({ overview }) {
  if (!overview) return null;
  const { kpi, tasksToday, activeAutomations } = overview;
  const m = kpi?.metrics;

  return (
    <section className="overview">
      <div className="overview-head">
        <h2>Portfolio overview</h2>
        {kpi && (
          <span className="overview-meta">
            Buildium sync · {kpi.financials_period || m?.financials_period || ""} · as of{" "}
            {new Date(kpi.snapshot_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        )}
      </div>
      <div className="kpi-grid">
        <Tile label="Occupancy" value={m ? pct(m.occupancy_rate) : "—"} sub={m ? `${m.occupied_units} of ${m.total_units} units` : ""} tone={m && m.occupancy_rate < 0.9 ? "warn" : "good"} />
        <Tile label="Vacant units" value={m ? m.vacant_units : "—"} sub={m ? `${money(m.market_rent_lost_to_vacancy)} lost rent/mo` : ""} tone="warn" />
        <Tile label="Rent collection" value={m ? pct(m.rent_collection_rate) : "—"} sub="cash received ÷ billed" tone={m && m.rent_collection_rate < 0.9 ? "bad" : "good"} />
        <Tile label="Outstanding balance" value={m ? money(m.outstanding_balance) : "—"} sub={m ? `avg ${money(m.avg_arrears_per_unit)}/unit` : ""} tone="bad" />
        <Tile label="Net operating income" value={m ? money(m.net_operating_income) : "—"} sub={m ? `on ${money(m.total_income)} income` : ""} tone="good" />
        <Tile label="Open tasks today" value={tasksToday?.open ?? "—"} sub={`${tasksToday?.done ?? 0} completed`} tone={tasksToday?.overdue ? "warn" : "neutral"} />
        <Tile label="Overdue" value={tasksToday?.overdue ?? 0} sub="tasks past due" tone={tasksToday?.overdue ? "bad" : "good"} />
        <Tile label="Active automations" value={activeAutomations ?? "—"} sub="feeding this board" tone="neutral" />
      </div>
    </section>
  );
}
