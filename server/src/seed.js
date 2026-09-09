import { db } from "./db.js";

const MEMBERS = [
  { name: "Yossi Myers", role: "Owner / Principal", email: "yossi@ezmanagementct.com", color: "#6366f1" },
  { name: "Rachel Zohar", role: "Accounting & Bookkeeping", email: "", color: "#16a34a" },
  { name: "Adelin Ayon", role: "Leasing & Tenant Relations", email: "", color: "#d97706" },
  { name: "Shmuel Avraham", role: "Maintenance & Facilities", email: "", color: "#0ea5e9" },
  { name: "Eli Zohar", role: "Principal / Owner", email: "", color: "#9333ea" },
  { name: "Yosef Ben Shabbat", role: "Maintenance & Facilities", email: "", color: "#0891b2" },
  { name: "Menachem Cohen", role: "Operations", email: "", color: "#dc2626" },
  { name: "Sara Fedorovsky", role: "Office Administration", email: "", color: "#db2777" },
  { name: "Vanessa", role: "Office Administration", email: "", color: "#ca8a04" },
  { name: "Fidel", role: "Maintenance & Facilities", email: "", color: "#65a30d" },
];

// Recurring task templates, one per live Claude Cowork automation ("Routine")
// configured for EZ Management LLC. cron_expr day/month/weekday fields are
// carried over from the real routine so the dashboard materializes the same
// cadence; minute/hour are informational only (see cronMatch.js).
const TEMPLATES = [
  {
    title: "Seasonal Preventive Maintenance Reminder",
    description: "Point in the year to schedule seasonal preventive maintenance across properties: heating servicing before winter (Sep/Dec runs) or cooling & gutter/exterior checks before spring/summer (Mar/Jun runs). Reminder only — no Buildium changes or vendor scheduling automatically.",
    category: "maintenance",
    cadence_label: "Quarterly (Mar 1, Jun 1, Sep 1, Dec 1)",
    cron_expr: "45 14 1 3,6,9,12 *",
    sop_ref: "SOP-MNT-06",
    assignees: ["Shmuel Avraham", "Yossi Myers"],
  },
  {
    title: "Weekly Cash Flow Digest",
    description: "Check each Buildium bank account balance and large payments due in the coming week (mortgages, major vendor payments). Compile a cash-position summary and flag anything larger than the balance comfortably covers. Read-only.",
    category: "accounting",
    cadence_label: "Weekly (Monday)",
    cron_expr: "30 14 * * 1",
    sop_ref: "SOP-BANK-03",
    assignees: ["Rachel Zohar", "Yossi Myers"],
  },
  {
    title: "NSF / Bounced Payment Alert",
    description: "Check for any rent payment marked bounced/returned/NSF in the last day. Draft (do not send) a tenant notification about the bounced payment and any applicable NSF fee for review.",
    category: "accounting",
    cadence_label: "Daily",
    cron_expr: "15 14 * * *",
    sop_ref: "SOP-AR-03",
    assignees: ["Rachel Zohar", "Yossi Myers"],
  },
  {
    title: "Recurring Bill Calendar Check",
    description: "Review recurring/standing bills (mortgages, standing service contracts) and confirm each one due in the next 14 days has a corresponding scheduled payment in Buildium. Flag anything due soon with no scheduled payment. Read-only.",
    category: "accounting",
    cadence_label: "Weekly (Monday)",
    cron_expr: "0 14 * * 1",
    sop_ref: "SOP-AP-05",
    assignees: ["Rachel Zohar", "Yossi Myers"],
  },
  {
    title: "Month-End Close Checklist Tracker",
    description: "Status check: (1) AP-inbox bills have a matching Buildium Finances entry, (2) bank accounts reconciled for the current statement period, (3) last month's owner statements were generated. Status check only.",
    category: "accounting",
    cadence_label: "Monthly (28th)",
    cron_expr: "45 13 28 * *",
    sop_ref: "",
    assignees: ["Rachel Zohar", "Yossi Myers"],
  },
  {
    title: "Quarterly Buildium Access Audit",
    description: "Pull the full current list of Staff, Rental Owner, and Vendor accounts with role/permission level from Buildium Settings > Users. Compare against the known employee roster and flag any account belonging to someone not on the roster, or a departed employee.",
    category: "compliance",
    cadence_label: "Quarterly (Jan/Apr/Jul/Oct 1)",
    cron_expr: "30 13 1 1,4,7,10 *",
    sop_ref: "",
    assignees: ["Yossi Myers"],
  },
  {
    title: "Tenant Complaint SLA Check",
    description: "Review tenant complaints/issues logged in the system and identify any open more than 5 business days without a resolution note, per the same-week response SOP. Read-only.",
    category: "leasing",
    cadence_label: "Daily",
    cron_expr: "15 13 * * *",
    sop_ref: "SOP-TEN-03",
    assignees: ["Adelin Ayon", "Yossi Myers"],
  },
  {
    title: "Vendor Invoice Review & Related-Party Flags",
    description: "Review vendor invoices entered in the last day. Flag any invoice with no associated approved estimate, a material mismatch vs. estimate (>~10%), or from a related-party vendor (e.g. any \"BH\" / BH Construction invoice) needing extra review.",
    category: "accounting",
    cadence_label: "Daily",
    cron_expr: "0 13 * * *",
    sop_ref: "",
    assignees: ["Rachel Zohar", "Yossi Myers"],
  },
  {
    title: "Lease Renewal Window Tracker",
    description: "Review active leases and identify any expiring within 60 days, grouped into 60/30/14-day windows. Read-only — nothing is sent to tenants automatically. Feeds the renewal process for anything in the 60-day window not yet started.",
    category: "leasing",
    cadence_label: "Weekly (Monday)",
    cron_expr: "45 12 * * 1",
    sop_ref: "SOP-LEA-06",
    assignees: ["Adelin Ayon", "Yossi Myers"],
  },
  {
    title: "Owner Statement Pre-Review Compilation",
    description: "Review prior month transactions per property/owner and compile a draft-review note: total income, total expenses, and anything unusual vs. the prior month. Does not generate or send the owner-facing statement.",
    category: "accounting",
    cadence_label: "Monthly (2nd)",
    cron_expr: "0 13 2 * *",
    sop_ref: "",
    assignees: ["Rachel Zohar", "Yossi Myers"],
  },
  {
    title: "Maintenance Email-to-Task Creation",
    description: "Check the main inbox for maintenance-related emails that did not come through Buildium's resident portal and don't yet have a matching Buildium maintenance task. Create the task with property/unit and issue description, assigned to Adelin.",
    category: "maintenance",
    cadence_label: "Twice daily",
    cron_expr: "0 13,18 * * *",
    sop_ref: "",
    assignees: ["Adelin Ayon"],
  },
  {
    title: "AP Bill Draft-Entry Assistant",
    description: "Review bills labeled in the AP inbox since yesterday's run. Extract vendor, invoice amount, invoice date, due date, and property/unit. Draft/extract only — nothing is entered into Buildium or paid.",
    category: "accounting",
    cadence_label: "Daily",
    cron_expr: "30 15 * * *",
    sop_ref: "",
    assignees: ["Rachel Zohar", "Yossi Myers"],
  },
  {
    title: "Daily Automation Health Digest",
    description: "Verify the other morning automations (rent reminders, vacant-unit listing sync, Gmail triage, AP-inbox labeling) fired successfully today without an error or blocked-run outcome.",
    category: "ops",
    cadence_label: "Daily",
    cron_expr: "30 15 * * *",
    sop_ref: "",
    assignees: ["Yossi Myers"],
  },
  {
    title: "Weekly Delinquency Tracking Digest",
    description: "Pull the current rent delinquency/aging report. For each tenant past the automated reminder sequence (due date, day 7, day 10) with no payment, list tenant/unit, days outstanding, and balance so collections action can be decided. Read-only.",
    category: "accounting",
    cadence_label: "Weekly (Monday)",
    cron_expr: "30 15 * * 1",
    sop_ref: "SOP-AR-01",
    assignees: ["Yossi Myers", "Rachel Zohar"],
  },
  {
    title: "Stale Maintenance Work Order Flagging",
    description: "Review all open maintenance tasks. Flag any open more than 5 business days if routine, or more than 48 hours if urgent/emergency, with no recent activity or assignee acknowledgment. Read-only.",
    category: "maintenance",
    cadence_label: "Daily",
    cron_expr: "30 15 * * *",
    sop_ref: "",
    assignees: ["Yossi Myers"],
  },
  {
    title: "Vacant Unit Data-Completeness Check",
    description: "For every unit shown vacant now in Leasing > Listings, confirm rent amount, security deposit, available date, description, and listing contact are present and current. Read-only.",
    category: "leasing",
    cadence_label: "Daily",
    cron_expr: "30 15 * * *",
    sop_ref: "",
    assignees: ["Yossi Myers"],
  },
  {
    title: "Website — Buildium Listing Sync",
    description: "Sync live listings on ezmanagementct.com from Buildium's Listed units, rebuild the static site, and deploy to Cloudflare Pages Production.",
    category: "ops",
    cadence_label: "Daily",
    cron_expr: "0 16 * * *",
    sop_ref: "",
    assignees: ["Yossi Myers"],
  },
  {
    title: "AP Inbox Labeling",
    description: "Label new mail in accountspayable@ezmanagementct.com via browser automation (no direct Gmail connector for this mailbox) so the AP Bill Draft-Entry Assistant can pick up newly labeled bills.",
    category: "ops",
    cadence_label: "Weekdays",
    cron_expr: "30 15 * * 1-5",
    sop_ref: "",
    assignees: ["Rachel Zohar"],
  },
  {
    title: "Vacant-Unit Listing Automation",
    description: "Check for newly-vacant units with no active listing; auto-post the ones that pass the data-completeness and exclusion checks (pre-approved auto-post mode), skip and flag anything that fails a check.",
    category: "leasing",
    cadence_label: "Daily",
    cron_expr: "30 15 * * *",
    sop_ref: "",
    assignees: ["Adelin Ayon"],
  },
  {
    title: "KPI Dashboard — Monthly Financial Sync",
    description: "Pull last month's full financials, current leasing/occupancy/collections numbers, and a trailing-12-month turnover estimate from Buildium; add a snapshot to the KPI Ledger and email a full monthly summary.",
    category: "accounting",
    cadence_label: "Monthly (1st)",
    cron_expr: "30 15 1 * *",
    sop_ref: "",
    assignees: ["Yossi Myers"],
  },
  {
    title: "Daily Gmail Triage",
    description: "Scan unread inbox messages from the last 24 hours and categorize by priority (Urgent / Needs reply / FYI), always flagging Buildium maintenance-request emails as Urgent.",
    category: "ops",
    cadence_label: "Daily",
    cron_expr: "30 15 * * *",
    sop_ref: "",
    assignees: ["Yossi Myers"],
  },
];

// Latest known portfolio snapshot (from the EZ Management KPI Ledger, Sep 3 2026 sync).
const KPI_SNAPSHOT = {
  snapshot_date: "2026-09-03",
  note: "Seed snapshot carried over from the EZ Management KPI Ledger artifact (Buildium sync, Sep 3, 2026).",
  metrics: {
    total_units: 244,
    occupied_units: 194,
    vacant_units: 50,
    occupancy_rate: 0.795,
    vacancy_rate: 0.205,
    rent_collection_rate: 0.526,
    avg_arrears_per_unit: 3456,
    outstanding_balance: 670423,
    net_operating_income: 68232,
    total_income: 210677,
    total_expense: 142445,
    repairs_and_maintenance: 74913,
    recurring_rent_billed: 348222,
    cash_rent_received: 183210,
    deposits_held: 384291,
    tenant_turnover_rate: 0.074,
    market_rent_lost_to_vacancy: 13960,
    financials_period: "Aug 2026",
  },
};

function seed() {
  const memberCount = db.prepare("SELECT COUNT(*) AS n FROM team_members").get().n;
  if (memberCount === 0) {
    const insertMember = db.prepare(
      "INSERT INTO team_members (name, role, email, color, sort_order) VALUES (?, ?, ?, ?, ?)"
    );
    MEMBERS.forEach((m, i) => insertMember.run(m.name, m.role, m.email, m.color, i));
    console.log(`Seeded ${MEMBERS.length} team members.`);
  }

  const templateCount = db.prepare("SELECT COUNT(*) AS n FROM task_templates").get().n;
  if (templateCount === 0) {
    const insertTemplate = db.prepare(
      `INSERT INTO task_templates (title, description, category, cadence_label, cron_expr, sop_ref, source, status)
       VALUES (?, ?, ?, ?, ?, ?, 'automation', 'active')`
    );
    const insertAssignee = db.prepare(
      "INSERT INTO template_assignees (template_id, member_id) VALUES (?, ?)"
    );
    const getMemberId = db.prepare("SELECT id FROM team_members WHERE name = ?");

    for (const t of TEMPLATES) {
      const result = insertTemplate.run(
        t.title,
        t.description,
        t.category,
        t.cadence_label,
        t.cron_expr,
        t.sop_ref,
      );
      const templateId = result.lastInsertRowid;
      for (const name of t.assignees) {
        const member = getMemberId.get(name);
        if (member) insertAssignee.run(templateId, member.id);
      }
    }
    console.log(`Seeded ${TEMPLATES.length} task templates.`);
  }

  const kpiCount = db.prepare("SELECT COUNT(*) AS n FROM kpi_snapshots").get().n;
  if (kpiCount === 0) {
    db.prepare(
      "INSERT INTO kpi_snapshots (snapshot_date, metrics_json, note) VALUES (?, ?, ?)"
    ).run(KPI_SNAPSHOT.snapshot_date, JSON.stringify(KPI_SNAPSHOT.metrics), KPI_SNAPSHOT.note);
    console.log("Seeded KPI snapshot.");
  }
}

seed();
