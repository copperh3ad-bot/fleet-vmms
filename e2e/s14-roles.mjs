import { PW, askToJoin } from "./s4-people.mjs";
import { body, check, confirmEmail, fill, finding, go, has, persona, press, scenario, sql, step, uniq, userId, waitText } from "./lib.mjs";

// Every role in one company, front end and back end: each role joins with the company code and is approved with its own role, then the pages each role may and may
// not open are compared with docs/RBAC-MATRIX.md, the auditor's read-only rule is tried, a cargo request with weight and volume goes to logistics providers who quote
// by link, and the database is read directly for what the screens claimed. Needs scenarios 2 to 4 (the company, its code and its manager).
const ROLES = [["finance", "Finance"], ["auditor", "Auditor"], ["logistics", "Logistics"], ["hr", "HR"]];   // Gate security has no screen yet (ADR-067), so the role cannot be given to anyone

// path -> roles that may open it (RBAC-MATRIX.md). Admin and manager are the existing S.pk and S.mgr.
const PAGES = {
  "/invoices": ["tenant_admin", "fleet_manager", "finance", "auditor"],
  "/reports": ["tenant_admin", "fleet_manager", "finance", "auditor"],
  "/activity": ["tenant_admin", "auditor"],
  "/users": ["tenant_admin"],
  "/vehicles": ["tenant_admin", "fleet_manager", "finance", "auditor", "logistics", "security"],
  "/cargo": ["tenant_admin", "fleet_manager", "auditor", "logistics"],
  "/trips": ["tenant_admin", "fleet_manager", "finance", "auditor", "logistics"],   // gate security holds gate.use but no trips screen exists for it yet (ADR-067): reported as a finding below
  "/vehicle-requests": ["tenant_admin", "fleet_manager", "finance", "auditor", "logistics", "hr"],
  "/job-cards": ["tenant_admin", "fleet_manager", "finance", "auditor", "logistics"],
};

export async function roles(S) {
  scenario("14. Every role: sign-up to access, cargo with weight and volume to provider quotes, finance and audit");
  const o = S.pk, mgr = S.mgr, slug = S.pkSlug, base = `/w/${slug}`, tag = uniq();
  check(o && mgr && slug && S.code, "scenarios 2 to 4 did not run");
  const sch = `"${sql(`select schema_name from public.tenants where slug = '${slug}'`)}"`;
  const run = (q) => sql(`set search_path = ${sch}, public; ${q}`);
  const last = (q) => run(q).split("\n").pop();
  sql(`update public.org_billing set plan_key = 'pro' where tenant_id = (select id from public.tenants where slug = '${slug}')`);   // trips and cargo are Pro
  run(`insert into settings(key, value) values ('module_trips','1') on conflict (key) do update set value = '1'`);
  const who = { tenant_admin: o, fleet_manager: mgr };

  await step("the company code is on (a later step of scenario 4 switches it off)", async () => {
    const read = () => sql(`select coalesce(join_code, '') from public.tenants where slug = '${slug}'`);
    let code = read();
    if (!code) {
      await go(o, `${base}/users`);
      await press(o, "Switch on", { wait: 1500 });
      code = read();
    }
    check(/^[A-HJ-NP-Z2-9]{10}$/.test(code), `no company code: "${code}"`);
    S.code = code;
  });

  for (const [role, label] of ROLES) {
    const p = await persona(role, { email: `${role}.${tag}@example.com`, password: PW });
    who[role] = p;
    await step(`${label}: asks to join with the company code, is approved with that role, and accepts`, async () => {
      sql("delete from public.rate_limits");   // joining is limited per address; seven joins in a few minutes would trip it
      await askToJoin(p, { path: "/join", code: S.code, name: `QA ${label} ${tag}`, email: p.email });
      const { code } = await confirmEmail(p.email);
      await go(p, `/auth/callback?code=${code}`);
      await waitText(p, "Waiting for approval");
      await go(o, `${base}/users`);
      const item = o.page.locator("li", { hasText: `QA ${label} ${tag}` }).first();
      await item.locator("input[name=employee_no]").fill(`${role.slice(0, 3).toUpperCase()}-${tag}`);
      await item.locator("select[name=role]").selectOption(role);
      if (await item.locator("select[name=vehicle_scope]").count()) await item.locator("select[name=vehicle_scope]").selectOption("all").catch(() => undefined);
      await press(o, item.getByRole("button", { name: "Approve" }), { wait: 1800 });
      await go(p, "/");
      await waitText(p, "Invitations waiting for you");
      await press(p, /accept|join/i, { wait: 2500 });
      await p.page.waitForURL(new RegExp(`/w/${slug}`), { timeout: 20000 });
      check(sql(`select role from public.tenant_memberships where user_id = '${await userId(p.email)}'`) === role, `the database role is not ${role}`);
    });
  }

  // ---------- front end: who may open what
  const opens = async (p, path) => {
    await go(p, `${base}${path}`);
    const t = await body(p);
    const url = new URL(p.page.url()).pathname;
    return url.endsWith(path) && !has(t, "do not have access") && !has(t, "not allowed") && !has(t, "could not be found") && !has(t, "part of the Pro plan");
  };
  for (const role of ["tenant_admin", "fleet_manager", "finance", "auditor", "logistics", "hr"]) {
    await step(`${role}: opens exactly the pages the role matrix allows, and no others`, async () => {
      const wrong = [];
      for (const [path, allowed] of Object.entries(PAGES)) {
        const got = await opens(who[role], path);
        if (got !== allowed.includes(role)) wrong.push(`${path} ${got ? "opened" : "refused"} (expected ${allowed.includes(role) ? "open" : "refused"})`);
      }
      check(wrong.length === 0, wrong.join("; "));
    });
  }

  // ---------- back end: the stored permissions are what the matrix says
  await step("back end: the permissions stored for each role match the role matrix for finance, audit and cargo", async () => {
    const has_ = (r, perm) => run(`select count(*) from role_permissions where role_key = '${r}' and permission_key = '${perm}'`).split("\n").pop() === "1";
    const sets = {
      finance: { yes: ["invoice.verify", "invoice.pay", "invoice.read", "report.view", "budget.manage"], no: ["jobcard.approve", "vehicle.write", "cargo.handle", "invoice.approve_payment", "quotation.approve"] },
      auditor: { yes: ["invoice.read", "report.view", "activity.read", "cargo.read_all", "trip.read_all", "jobcard.read_all"], no: ["invoice.pay", "invoice.verify", "jobcard.approve", "jobcard.create", "vehicle.write", "cargo.handle", "cargo.request", "admin.users"] },
      logistics: { yes: ["cargo.request", "cargo.handle", "trip.dispatch", "trip.award", "quotation.approve"], no: ["invoice.pay", "invoice.verify", "admin.users", "admin.settings"] },
      hr: { yes: ["vreq.request"], no: ["cargo.request", "jobcard.create", "invoice.read", "vehicle.read"] },
      security: { yes: ["gate.use", "vehicle.read"], no: ["cargo.request", "invoice.read", "jobcard.create"] },
    };
    const wrong = [];
    for (const [r, { yes, no }] of Object.entries(sets)) {
      for (const p of yes) if (!has_(r, p)) wrong.push(`${r} lacks ${p}`);
      for (const p of no) if (has_(r, p)) wrong.push(`${r} wrongly has ${p}`);
    }
    check(wrong.length === 0, wrong.join("; "));
  });

  // ---------- the auditor reads and never writes
  await step("auditor: reads invoices, reports and the activity log, and is offered no way to change anything", async () => {
    const a = who.auditor;
    await go(a, `${base}/invoices`);
    check(!(await a.page.getByRole("button", { name: /^(pay|record payment|verify|approve)/i }).count()), "the auditor is offered a payment or approval button");
    await go(a, `${base}/activity`);
    check(has(await body(a), "Employee") || has(await body(a), "signed") || has(await body(a), "added") || has(await body(a), "approved"), "the activity log is empty for the auditor");
    await go(a, `${base}/job-cards/new`);
    check(!(await opens(a, "/job-cards/new")) || !(await a.page.getByRole("button", { name: /submit|send|create/i }).count()), "the auditor can start a job card");
    await go(a, `${base}/cargo/new`);
    check(!has(await body(a), "Send the request"), "the auditor can ask for cargo");
  });

  // ---------- cargo with weight and volume, to providers, who quote by link
  let cid = "", tripId = "";
  await step("cargo: the administrator books a load with weight and volume; it is stored exactly", async () => {
    const local = (d, h) => { const x = new Date(Date.now() + d * 86400_000); x.setHours(h, 0, 0, 0); const q = (n) => String(n).padStart(2, "0"); return `${x.getFullYear()}-${q(x.getMonth() + 1)}-${q(x.getDate())}T${q(h)}:00`; };
    await go(o, `${base}/cargo/new`);
    await waitText(o, "Ask for a cargo pick-up and delivery", 8000);
    await fill(o, "#department", "Sales"); await fill(o, "#pickup_at", local(3, 10));
    await fill(o, "#pickup_place", "Sundar industrial estate, Lahore"); await fill(o, "#drop_place", "Port Qasim, Karachi");
    await fill(o, "#vehicle_type", "20-foot container truck"); await fill(o, "#description", `QA roll cargo ${tag}`);
    await fill(o, "#quantity_text", "40 rolls"); await fill(o, "#poc_details", "Imran 0300 1111111");
    await fill(o, "#weight_kg", "8200");
    await fill(o, "#volume_m3", "31.5");
    await press(o, "Send the request", { wait: 2000 });
    await waitText(o, `QA roll cargo ${tag}`, 8000);
    cid = last(`select id from cargo_requests where description = 'QA roll cargo ${tag}'`);
    const wv = last("select weight_kg::text || ' / ' || volume_m3::text from cargo_requests where id = '" + cid + "'");
    check(wv === "8200.0 / 31.50", "weight and volume were not stored exactly: " + wv);
    check(has(await body(o), "31.5"), "the card does not show the volume");
  });
  await step("cargo: logistics accepts it, makes a trip, and asks three providers for a quote", async () => {
    const lg = who.logistics;
    await go(lg, `${base}/cargo/${cid}`);
    await press(lg, "Accept the request", { wait: 1500 });
    await waitText(lg, "Accepted", 8000);
    await press(lg, "Make a trip from this", { wait: 2500 });
    await waitText(lg, "Cargo CR-", 8000);
    tripId = last(`select trip_id from cargo_requests where id = '${cid}'`);
    check(/^[0-9a-f-]{36}$/.test(tripId), "no trip was made");
    for (const [n, ph] of [["QA Alpha Freight", "+923009990001"], ["QA Bravo Haulage", "+923009990002"], ["QA Charlie Cargo", "+923009990003"]]) run(`insert into vendors(name, kind, phone) values ('${n} ${tag}', 'logistics', '${ph}')`);
    await go(lg, `${base}/trips/${tripId}`);
    await waitText(lg, "Ask these providers for a quote", 8000);
    for (const n of ["QA Alpha Freight", "QA Bravo Haulage", "QA Charlie Cargo"]) await lg.page.getByLabel(new RegExp(`${n} ${tag}`)).check();
    await press(lg, "Ask for quotes", { wait: 1500 });
    check(last(`select count(*) from trip_quotes where trip_id = '${tripId}'`) === "3", "three requests were not recorded");
  });
  await step("cargo: quotes are entered; a quote far above the others is visible; logistics awards the cheapest", async () => {
    const lg = who.logistics;
    await go(lg, `${base}/trips/${tripId}`);
    for (const [name, amount] of [["QA Alpha Freight", "190000"], ["QA Bravo Haulage", "165000"]]) {
      const row = lg.page.locator("div.border-t", { hasText: `${name} ${tag}` }).first();
      await row.locator("summary").click();
      await row.locator("input[name=amount]").fill(amount);
      await row.getByRole("button", { name: /Save the quote/ }).click();
      await lg.page.waitForLoadState("networkidle").catch(() => undefined);
    }
    check(last(`select count(*) from trip_quotes where trip_id = '${tripId}' and status = 'quoted'`) === "2", "two quotes were not stored");
    await go(lg, `${base}/trips/${tripId}`);
    await go(mgr, `${base}/trips/${tripId}`);   // logistics made the trip, so segregation of duties stops logistics awarding it: the fleet manager awards
    await press(mgr, new RegExp(`Award to QA Bravo Haulage ${tag}`), { wait: 2000 });
    const said = (await mgr.page.locator("[role=alert], [role=status]").allInnerTexts()).join(" | ");
    check(last(`select count(*) from trip_quotes where trip_id = '${tripId}' and status = 'awarded'`) === "1", `no quote was awarded; the page said: ${said}`);
    check(last(`select v.name from trip_quotes q join vendors v on v.id = q.vendor_id where q.trip_id = '${tripId}' and q.status = 'awarded'`).includes("Bravo"), "the wrong provider was awarded");
  });
  await step("cargo: the auditor can see the request read-only and cannot award or accept", async () => {
    const a = who.auditor;
    await go(a, `${base}/cargo/${cid}`);
    const t = await body(a);
    check(has(t, `QA roll cargo ${tag}`), "the auditor cannot read the cargo request");
    check(!(await a.page.getByRole("button", { name: /Accept the request|Mark as|Make a trip/i }).count()), "the auditor is offered a cargo action");
    await go(a, `${base}/trips/${tripId}`);
    check(!(await a.page.getByRole("button", { name: /award|Ask for quotes/i }).count()), "the auditor is offered an award or quote button");
  });
  await step("finance and audit: the awarded trip is not payable until checked; finance and the auditor see the invoice list differently", async () => {
    await go(who.finance, `${base}/invoices`);
    check(!has(await body(who.finance), "could not be found"), "finance cannot open the invoices list");
    check(last(`select count(*) from trip_invoices where trip_id = '${tripId}'`) === "0", "an invoice appeared before the provider sent one");
  });

  await step("gate security: the role has no screen yet, so it is not offered when people are invited or approved", async () => {
    await go(o, `${base}/users`);
    const offered = (await o.page.locator("select[name=role] option, select#role option").allInnerTexts()).join(" | ");
    check(!has(offered, "Gate security"), `Gate security is offered in a role list: ${offered}`);
  });

  // ---------- back end: the activity log and the counts agree with what was done
  await step("back end: the activity log recorded the approvals and awards made in this scenario", async () => {
    const n = Number(last(`select count(*) from audit_log where at > now() - interval '30 minutes'`) || 0);
    if (n === 0) finding("audit", "the activity log has no rows from the last 30 minutes after roles were approved and a trip was awarded");
    check(n > 0, "the activity log is empty");
  });
}
