import { body, check, go, has, persona, press, scenario, sql, step, userId, waitText } from "./lib.mjs";

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
    check(has(t, "Alpha Freight") && has(t, "Logistics") && has(t, "Type"), `the vendor list does not show the type: ${t.slice(0, 200)}`);
  });

  await step("the trip page offers the three providers, and asking them records one request each", async () => {
    await go(o, `${base}/trips/${trip}`);
    await waitText(o, "Ask these providers for a quote", 8000);
    for (const n of ["Alpha Freight", "Bravo Haulage", "Charlie Cargo"]) await o.page.getByLabel(new RegExp(n)).check();
    await press(o, "Ask for quotes", { wait: 1500 });
    await waitSql(() => run(`select count(*) from trip_quotes where trip_id = '${trip}'`).split("\n").pop(), "3");
    check(quoteOf("Alpha Freight") === "requested/", "the request was not recorded");
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

  await step("a provider with no account quotes through its single-use link, sent from the trip page", async () => {
    await go(o, `${base}/trips/${trip}`);
    const row = o.page.locator("div.border-t", { hasText: "Charlie Cargo" }).first();
    await row.getByRole("button", { name: /Send the link by phone/ }).click();
    const wa = row.getByRole("link", { name: /^Send on WhatsApp$/ });
    await wa.waitFor({ timeout: 8000 });
    const text = decodeURIComponent(String(await wa.getAttribute("href")));
    const link = text.match(/https?:\/\/[^\s"'<>]*\/q\/[A-Za-z0-9_-]+/)?.[0];
    check(link, `no link in the hand-off: ${text.slice(0, 160)}`);
    const P = await persona("provider", {});
    await P.page.goto(link, { waitUntil: "networkidle" });
    const t = await body(P);
    check(has(t, "Faisalabad") && has(t, "Send your quote"), `the provider does not see the trip: ${t.slice(0, 200)}`);
    check(!has(t, "Trip Asker") && !has(t, "Alpha Freight") && !has(t, "70,000"), "the provider can see who asked or what others quoted");
    await P.page.locator("#amount").fill("66,000");
    await P.page.locator("#vehicle_text").fill("Shehzore LEC-555");
    await P.page.getByRole("button", { name: "Send quote" }).click();
    await P.page.getByText(/Thank you/i).waitFor({ timeout: 10000 });
    await waitSql(() => quoteOf("Charlie Cargo"), "quoted/66000.00");
    await P.page.goto(link, { waitUntil: "networkidle" });
    check(has(await body(P), "This link is not working"), "the link works a second time");
    await go(o, `${base}/trips/${trip}`);
    const page = await body(o);
    check(has(page, "Lowest") && has(page, "66,000.00") && has(page, "through a link"), `the lowest quote is not marked, or the history does not say it came by link: ${page.slice(0, 200)}`);
  });

  await step("the administrator awards the cheapest; the trip is approved as outsourced and the others close", async () => {
    await go(o, `${base}/trips/${trip}`);
    await press(o, /Award to Charlie Cargo/, { wait: 2000 });
    await waitSql(() => run(`select status from trips where id = '${trip}'`).split("\n").pop(), "approved");
    check(run(`select outsourced_vendor_id is not null and vehicle_id is null and award_amount = 66000 from trips where id = '${trip}'`).split("\n").pop() === "t", "the trip is not outsourced at 66,000");
    check(quoteOf("Charlie Cargo").startsWith("awarded") && quoteOf("Alpha Freight").startsWith("closed") && quoteOf("Bravo Haulage").startsWith("closed"), "the other requests did not close");
    await go(o, `${base}/trips/${trip}`);
    const t = await body(o);
    check(has(t, "Logistics provider") && has(t, "Charlie Cargo") && has(t, "Awarded to Charlie Cargo"), `the page does not show the award: ${t.slice(0, 300)}`);
  });

  await step("an outsourced trip leaves and returns without asking for an odometer reading", async () => {
    await go(o, `${base}/trips/${trip}`);
    check(!(await o.page.locator("input[name=odometer]").count()), "an outsourced trip asks for an odometer reading");
    await press(o, "Mark as left", { wait: 1500 });
    await waitSql(() => run(`select status from trips where id = '${trip}'`).split("\n").pop(), "started", 8000);
    await press(o, "Mark as returned", { wait: 1500 });
    await waitSql(() => run(`select status from trips where id = '${trip}'`).split("\n").pop(), "completed", 8000);
  });

  let invoiceLink;
  await step("the provider invoices the returned trip through a single-use link", async () => {
    await go(o, `${base}/trips/${trip}`);
    await waitText(o, "Provider invoice", 8000);
    await o.page.getByRole("button", { name: /Ask for the invoice by phone/ }).click();
    const wa = o.page.getByRole("link", { name: /^Send on WhatsApp$/ });
    await wa.waitFor({ timeout: 8000 });
    invoiceLink = decodeURIComponent(String(await wa.getAttribute("href"))).match(/https?:\/\/[^\s"'<>]*\/q\/[A-Za-z0-9_-]+/)?.[0];
    check(invoiceLink, "no invoice link in the hand-off");
    const P = await persona("provider-invoice", {});
    await P.page.goto(invoiceLink, { waitUntil: "networkidle" });
    const t = await body(P);
    check(has(t, "Send your invoice") && has(t, "66,000.00") && has(t, "Faisalabad"), `the provider does not see the trip and the agreed price: ${t.slice(0, 200)}`);
    check(!has(t, "Trip Asker") && !has(t, "Alpha Freight") && !has(t, "70,000"), "the provider can see who asked or what others quoted");
    await P.page.locator("#invoice_no").fill("INV-E2E-1");
    await P.page.locator("#invoice_date").fill(new Date().toISOString().slice(0, 10));
    await P.page.getByRole("button", { name: "Send invoice" }).click();
    await P.page.getByText(/Thank you/i).waitFor({ timeout: 10000 });
    await waitSql(() => run(`select status || '/' || amount from trip_invoices where trip_id = '${trip}'`).split("\n").pop(), "submitted/66000.00");
    await P.page.goto(invoiceLink, { waitUntil: "networkidle" });
    check(has(await body(P), "This link is not working"), "the invoice link works a second time");
  });

  await step("the administrator who awarded the trip cannot check its invoice", async () => {
    await go(o, `${base}/trips/${trip}`);
    await waitText(o, "INV-E2E-1", 8000);
    await press(o, "Record the decision", { wait: 1500 });
    await waitText(o, "segregation of duties", 8000);
    check(run(`select status from trip_invoices where trip_id = '${trip}'`).split("\n").pop() === "submitted", "the invoice changed state");
  });

  await step("Finance checks it at the agreed amount; it is payable", async () => {
    const uid = await userId(S.mgr.email);
    const was = sql(`select role from public.tenant_memberships where user_id = '${uid}' and tenant_id = '${tid}'`);
    sql(`update public.tenant_memberships set role = 'finance' where user_id = '${uid}' and tenant_id = '${tid}'`);
    try {
      await go(S.mgr, `${base}/trips/${trip}`);
      await waitText(S.mgr, "INV-E2E-1", 8000);
      await press(S.mgr, "Record the decision", { wait: 1500 });
      await waitSql(() => run(`select status || '/' || payable from trip_invoices where trip_id = '${trip}'`).split("\n").pop(), "verified/66000.00");
      await go(S.mgr, `${base}/trips/${trip}`);
      check(has(await body(S.mgr), "Checked"), "the page does not say the invoice was checked");
    } finally { sql(`update public.tenant_memberships set role = '${was}' where user_id = '${uid}' and tenant_id = '${tid}'`); }
  });

  await step("an organization keeps its own reference rates for a provider, and sees them beside the quotes", async () => {
    await go(o, `${base}/vendors`);
    const row = o.page.locator("tr", { hasText: "Alpha Freight" }).first();
    await row.locator("summary", { hasText: /^Rate card/ }).click();
    await row.locator("input[name=label]").fill("Lahore to Karachi, 10-tonne truck");
    await row.locator("select[name=basis]").selectOption("per_trip");
    await row.locator("input[name=amount]").fill("185000");
    await row.getByRole("button", { name: "Add rate" }).click();
    await o.page.waitForLoadState("networkidle").catch(() => undefined);
    await waitSql(() => run(`select count(*) from provider_rates r join vendors v on v.id = r.vendor_id where v.name = 'Alpha Freight' and r.active and r.amount = 185000`).split("\n").pop(), "1");
    await go(o, `${base}/vendors`);
    await o.page.locator("tr", { hasText: "Alpha Freight" }).first().locator("summary", { hasText: /^Rate card/ }).click();
    check(has(await body(o), "Lahore to Karachi, 10-tonne truck"), "the rate card does not show the rate");
    const t2 = run(`insert into trips(requested_by, purpose, from_place, to_place, start_at, end_at) values ('${emp}', 'Rate check', 'Lahore', 'Karachi', now() + interval '6 days', now() + interval '6 days 8 hours') returning id`).split("\n").find((l) => /^[0-9a-f-]{36}$/.test(l));
    await go(o, `${base}/trips/${t2}`);
    await o.page.getByLabel(/Alpha Freight/).check();
    await press(o, "Ask for quotes", { wait: 1500 });
    await go(o, `${base}/trips/${t2}`);
    check(has(await body(o), "Your reference rates: Lahore to Karachi, 10-tonne truck, 185,000.00 per trip"), "the reference rate is not shown beside the provider's quote");
  });

  await step("the Outsourced trips page shows what each provider cost, and downloads as CSV", async () => {
    await go(o, `${base}/trips/outsourced`);
    await waitText(o, "By provider", 8000);
    const t = await body(o);
    check(has(t, "Charlie Cargo") && has(t, "66,000.00") && has(t, "Saved by comparing"), `the report does not show the awarded trip: ${t.slice(0, 300)}`);
    const res = await o.page.request.get(`${base}/export/outsourced-trips?months=12`);
    check(res.ok() && (await res.text()).includes("Charlie Cargo"), "the CSV does not hold the trip");
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
