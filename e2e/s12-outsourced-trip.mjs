import { body, check, go, shot, has, press, scenario, sql, step, waitText } from "./lib.mjs";

// ADR-078 phase A: a trip goes to three logistics providers, each quotes, the administrator awards the cheapest, and the trip is approved as outsourced.
// Needs scenarios 2 and 3 first (the company and its administrator). Setup (the module switch, the Pro plan, the vendors and the trip) is done in the database;
// everything the staff do is done in the browser.
export async function outsourcedTrip(S) {
  scenario("12. A trip is sent to logistics providers, who quote, and one is awarded");
  const o = S.pk, slug = S.pkSlug, base = `/w/${slug}`;
  check(o && slug, "scenarios 2 and 3 did not run");
  const tid = sql(`select id from public.tenants where slug = '${slug}'`);
  const sch = `"${sql(`select schema_name from public.tenants where slug = '${slug}'`)}"`;
  const run = (q) => sql(`set search_path = ${sch}, public; ${q}`);
  sql(`update public.org_billing set plan_key = 'pro' where tenant_id = '${tid}'`);
  run(`insert into settings(key, value) values ('module_trips','1') on conflict (key) do update set value = '1'`);
  const emp = run(`insert into employees(full_name, employee_no) values ('Trip Asker', 'TA-12') returning id`).split("\n").find((l) => /^[0-9a-f-]{36}$/.test(l));
  for (const [name, phone] of [["Alpha Freight", "+923001110001"], ["Bravo Haulage", "+923001110002"], ["Charlie Cargo", "+923001110003"]])
    run(`insert into vendors(name, kind, phone) values ('${name}', 'logistics', '${phone}')`);
  const trip = run(`insert into trips(requested_by, purpose, from_place, to_place, start_at, end_at) values ('${emp}', 'Move machinery to Faisalabad', 'Lahore', 'Faisalabad', now() + interval '3 days', now() + interval '3 days 8 hours') returning id`).split("\n").find((l) => /^[0-9a-f-]{36}$/.test(l));
  const waitSql = async (fn, want, ms = 8000) => {
    const t0 = Date.now(); let got;
    while (Date.now() - t0 < ms) { got = fn(); if (got === want) return got; await new Promise((r) => setTimeout(r, 300)); }
    throw new Error(`expected ${JSON.stringify(want)}, the database says ${JSON.stringify(got)}`);
  };
  const quoteOf = (name) => run(`select tq.status || '/' || coalesce(tq.amount::text, '') from trip_quotes tq join vendors v on v.id = tq.vendor_id where tq.trip_id = '${trip}' and v.name = '${name}'`).split("\n").pop();

  await step("the Vendors page tells workshops and logistics providers apart", async () => {
    await go(o, `${base}/vendors`);
    const t = await body(o);
    await shot(o, "audit-vendors");
    check(has(t, "Alpha Freight") && has(t, "Logistics") && has(t, "Type"), `the vendor list does not show the type: ${t.slice(0, 200)}`);
  });

  await step("the trip page offers the three providers, and asking them records one request each", async () => {
    await go(o, `${base}/trips/${trip}`);
    await waitText(o, "Ask these providers for a quote", 8000);
    for (const n of ["Alpha Freight", "Bravo Haulage", "Charlie Cargo"]) await o.page.getByLabel(new RegExp(n)).check();
    await press(o, "Ask for quotes", { wait: 1500 });
    await waitSql(() => run(`select count(*) from trip_quotes where trip_id = '${trip}'`).split("\n").pop(), "3");
    check(quoteOf("Alpha Freight") === "requested/", "the request was not recorded");
    await shot(o, "audit-trip-asked");
  });

  await step("the quotes are entered; the dearest and the cheapest show their amounts", async () => {
    await go(o, `${base}/trips/${trip}`);
    for (const [name, amount] of [["Alpha Freight", "85000"], ["Bravo Haulage", "70000"]]) {
      const row = o.page.locator("div.border-t", { hasText: name }).first();
      await row.locator("summary").click();
      await row.locator("input[name=amount]").fill(amount);
      await row.getByRole("button", { name: /Save the quote/ }).click();
      await o.page.waitForLoadState("networkidle").catch(() => undefined);
      await waitSql(() => quoteOf(name), `quoted/${amount}.00`, 8000);
    }
  });

  await step("audit shots of the main pages", async () => {
    await go(o, `${base}/trips/${trip}`); await shot(o, "audit-trip-quoted");
    for (const [n, path] of [["dashboard", ""], ["vehicles", "/vehicles"], ["jobcards", "/job-cards"], ["trips", "/trips"]]) { await go(o, base + path); await o.page.waitForTimeout(800); await shot(o, `audit-${n}`); }
  });

  await step("audit shots at phone width", async () => {
    await o.page.setViewportSize({ width: 390, height: 844 });
    try {
      for (const [n, path] of [["dashboard", ""], ["vehicles", "/vehicles"], ["vehicles-new", "/vehicles/new"], ["jobcards", "/job-cards"], ["jobcards-new", "/job-cards/new"], ["trip", `/trips/${trip}`], ["vendors", "/vendors"], ["users", "/users"]]) {
        await go(o, base + path); await o.page.waitForTimeout(700); await shot(o, `phone-${n}`);
        const overflow = await o.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        console.log(`PHONE ${n}: horizontal overflow ${overflow}px`);
      }
    } finally { await o.page.setViewportSize({ width: 1280, height: 900 }); }
  });

  await step("the administrator awards the cheapest; the trip is approved as outsourced and the others close", async () => {
    await go(o, `${base}/trips/${trip}`);
    await press(o, /Award to Bravo Haulage/, { wait: 2000 });
    await waitSql(() => run(`select status from trips where id = '${trip}'`).split("\n").pop(), "approved", 8000);
    check(run(`select outsourced_vendor_id is not null and vehicle_id is null and award_amount = 70000 from trips where id = '${trip}'`).split("\n").pop() === "t", "the trip is not outsourced at 70,000");
    check(quoteOf("Bravo Haulage").startsWith("awarded") && quoteOf("Alpha Freight").startsWith("closed") && quoteOf("Charlie Cargo").startsWith("closed"), "the other requests did not close");
    await go(o, `${base}/trips/${trip}`);
    const t = await body(o);
    check(has(t, "Logistics provider") && has(t, "Bravo Haulage") && has(t, "Awarded to Bravo Haulage"), `the page does not show the award: ${t.slice(0, 300)}`);
  });

  await step("an outsourced trip leaves and returns without asking for an odometer reading", async () => {
    await go(o, `${base}/trips/${trip}`);
    check(!(await o.page.locator("input[name=odometer]").count()), "an outsourced trip asks for an odometer reading");
    await press(o, "Mark as left", { wait: 1500 });
    await waitSql(() => run(`select status from trips where id = '${trip}'`).split("\n").pop(), "started", 8000);
    await press(o, "Mark as returned", { wait: 1500 });
    await waitSql(() => run(`select status from trips where id = '${trip}'`).split("\n").pop(), "completed", 8000);
  });

  await step("on Basic the section is not offered", async () => {
    sql(`update public.org_billing set plan_key = 'standard' where tenant_id = '${tid}'`);
    const t2 = run(`insert into trips(requested_by, purpose, from_place, to_place, start_at, end_at) values ('${emp}', 'Second move', 'Lahore', 'Multan', now() + interval '5 days', now() + interval '5 days 8 hours') returning id`).split("\n").find((l) => /^[0-9a-f-]{36}$/.test(l));
    try {
      await go(o, `${base}/trips/${t2}`);
      check(!has(await body(o), "Ask these providers for a quote"), "Basic shows the logistics providers section");
    } finally { sql(`update public.org_billing set plan_key = 'pro' where tenant_id = '${tid}'`); }
  });
}
