// The "Get started" walk-through for a new company (ADR-028). Each step is a thing that makes a part of the dashboard come alive,
// and whether it is done is read from the company's own data, so nobody ticks anything by hand and the list cannot go out of date.
// A person is shown only the steps their role can do. Hiding a step is cosmetic: the page behind it checks permission itself.
import type { Driver } from "@/lib/db/types";
import { withTenant } from "@/lib/db/tenant";
import type { Membership } from "@/lib/auth/can";

export type OnboardingStep = {
  key: string;
  title: string;
  /** What starts showing up once this is done. */
  why: string;
  /** Path under the workspace, no leading slash. */
  href: string;
  cta: string;
  done: boolean;
  /** Shown beside a step that is not finished, e.g. "2 vehicles still need it". Empty when there is nothing useful to say. */
  progress: string;
};

export type Onboarding = { steps: OnboardingStep[]; doneCount: number };

/** The cookie that remembers this person put the walk-through away for this workspace. */
export const onboardingCookie = (slug: string) => `gs_hidden_${slug}`;

type Def = { key: string; perm: string; title: string; why: string; href: string; cta: string; sql: string; done: (n: number) => boolean; progress?: (n: number) => string };

// Order matters: each step builds on the ones before it. `sql` returns one number; `done` decides from it.
const STEPS: Def[] = [
  { key: "vehicles", perm: "vehicle.write", title: "Add your vehicles", why: "Your fleet count, vehicle list and every report start here.", href: "vehicles/new", cta: "Add a vehicle",
    sql: "select count(*)::int n from vehicles", done: (n) => n > 0 },
  { key: "history", perm: "vehicle.write", title: "Enter each vehicle's last service date", why: "Service due can only say what is overdue once it knows when each vehicle was last serviced.", href: "vehicles", cta: "Open vehicles",
    // -1 when there are no vehicles yet: nothing can be "all done" for vehicles that do not exist
    sql: "select (case when not exists (select 1 from vehicles) then -1 else (select count(*) from vehicles v where not exists (select 1 from vehicle_service_baselines b where b.vehicle_id = v.id)) end)::int n", done: (n) => n === 0,
    progress: (n) => (n > 0 ? `${n} ${n === 1 ? "vehicle needs" : "vehicles need"} it` : "") },
  { key: "people", perm: "employee.manage", title: "Add your drivers and staff", why: "Jobs, costs and approvals are recorded against real people, each with an employee code.", href: "employees", cta: "Add employees",
    sql: "select count(*)::int n from employees", done: (n) => n > 1 },
  { key: "drivers", perm: "vehicle.write", title: "Say who drives which vehicle", why: "Cost lands on whoever held the vehicle at the time, and drivers see their own vehicle.", href: "vehicles", cta: "Open vehicles",
    sql: "select count(*)::int n from vehicle_custody where to_date is null", done: (n) => n > 0 },
  { key: "workshop", perm: "vendor.manage", title: "Add a workshop you use", why: "Jobs can be sent out for a quotation, and the workshop scorecard begins.", href: "vendors", cta: "Add a workshop",
    sql: "select count(*)::int n from vendors", done: (n) => n > 0 },
  { key: "budget", perm: "budget.manage", title: "Set a budget", why: "Spend is shown against it, and vehicles over budget are flagged.", href: "budgets", cta: "Set a budget",
    sql: "select count(*)::int n from budgets", done: (n) => n > 0 },
  { key: "papers", perm: "compliance.manage", title: "Add vehicle papers", why: "Insurance, fitness and token tax get expiry reminders before they lapse.", href: "compliance", cta: "Add papers",
    sql: "select ((select count(*) from compliance_docs) + (select count(*) from insurance_policies))::int n", done: (n) => n > 0 },
  { key: "team", perm: "admin.users", title: "Invite your team", why: "The people who raise and approve jobs sign in with their own login.", href: "users", cta: "Invite someone",
    sql: "select count(*)::int n from employees where user_id is not null", done: (n) => n > 1 },
  { key: "job", perm: "jobcard.create", title: "Raise your first job card", why: "Spend, repeat repairs and the reasons chart fill in as jobs are closed.", href: "job-cards/new", cta: "New job card",
    sql: "select count(*)::int n from job_cards", done: (n) => n > 0 },
];

/** The steps this person can act on, or null when none of them is theirs to do. */
export function getOnboarding(driver: Driver, m: Membership): Promise<Onboarding | null> {
  return withTenant(driver, m, async (q) => {
    const held = new Set((await q.query<{ permission_key: string }>("select permission_key from role_permissions where role_key = $1", [m.role])).rows.map((r) => r.permission_key));
    const mine = STEPS.filter((s) => held.has(s.perm));
    // Raising a job card is something a driver can do too, but company set-up is not theirs: with nothing else to do, there is no walk-through.
    if (!mine.some((s) => s.key !== "job")) return null;
    const steps: OnboardingStep[] = [];
    for (const s of mine) {
      const n = (await q.query<{ n: number }>(s.sql)).rows[0]?.n ?? 0;
      const done = s.done(n);
      steps.push({ key: s.key, title: s.title, why: s.why, href: s.href, cta: s.cta, done, progress: !done && s.progress ? s.progress(n) : "" });
    }
    return { steps, doneCount: steps.filter((s) => s.done).length };
  });
}
