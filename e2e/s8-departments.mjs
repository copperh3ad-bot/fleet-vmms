import { body, check, confirmEmail, confirmJoinOnWhatsApp, fill, finding, go, has, persona, phoneFor, press, scenario, sql, step, uniq, userId, waitText } from "./lib.mjs";

// ADR-048 phase 48c: operating departments in the browser. A logistics login reaches only the Logistics vehicles; the
// department shows on the vehicle list and filters it; the department user cannot import, move vehicles or see the cost reports.
const PW = ["a", "long", "test", "password", "1"].join("-");
const schemaOf = (slug) => sql(`select schema_name from public.tenants where slug = '${slug}'`);

export async function departments(S) {
  scenario("8. Operating departments: a logistics login sees only its own vehicles");
  const o = S.pk, slug = S.pkSlug, base = `/w/${slug}`, tag = uniq();
  check(o && slug, "scenarios 2 to 4 did not run");
  sql("delete from public.rate_limits");          // scenario 4 used most of the hourly joins from this one address
  const sch = `"${schemaOf(slug)}"`;
  // Logistics sees the whole fleet by default (ADR-075). These steps test a department role that is limited to its own department, so it is switched to that mode first.
  sql(`set search_path = ${sch}, public; update role_departments set sees_all_vehicles = false where role_key = 'logistics'`);
  const [mine1, mine2, other] = ["LHR-1001", "LHR-1002", "DPT-3001"];
  await step("a third vehicle, for the general fleet, is added with the form", async () => {
    await go(o, `${base}/vehicles/new`);
    await fill(o, "#registration_no", other); await o.page.selectOption("#make", "Suzuki"); await o.page.selectOption("#model", "Bolan"); await o.page.selectOption("#year", String("2020"));
    await o.page.selectOption("#fuel_type", { index: 1 });
    await fill(o, "#odometer_km", "30000");
    await press(o, "Save vehicle", { wait: 1500 });
    await waitText(o, other, 8000);
    check(sql(`select count(*) from ${sch}.vehicles where registration_no in ('${mine1}','${mine2}','${other}')`) === "3", "the three vehicles are not all there");
  });

  await step("the administrator puts two vehicles in Logistics, from the vehicle page", async () => {
    for (const plate of [mine1, mine2]) {
      const id = sql(`select id from ${sch}.vehicles where registration_no = '${plate}'`);
      await go(o, `${base}/vehicles/${id}`);
      await fill(o, "#department", "Logistics");
      await press(o, o.page.locator("form", { has: o.page.locator("#department") }).getByRole("button", { name: "Save" }), { wait: 1200 });
      check(sql(`select department from ${sch}.vehicles where id = '${id}'`) === "Logistics", `${plate} did not get the department`);
    }
  });

  await step("the vehicle list shows each vehicle's department and a department filter that narrows it", async () => {
    await go(o, `${base}/vehicles`);
    let t = await body(o);
    check(has(t, mine1) && has(t, other), "the list is missing vehicles");
    check(await o.page.locator("select#dept").count() === 1, "no department filter");
    await o.page.locator("select#dept").selectOption("Logistics");
    await press(o, o.page.getByRole("button", { name: "Show", exact: true }).first(), { wait: 1200 });
    t = await body(o);
    check(o.page.url().includes("dept=Logistics"), `url ${o.page.url()}`);
    check(has(t, mine1) && has(t, mine2) && !has(t, other), "the filter did not narrow the list");
    await go(o, `${base}/vehicles?dept=_none`);
    t = await body(o);
    check(has(t, other) && !has(t, mine1), "no department did not show the general fleet");
  });

  const lg = await persona("logistics", { email: `logistics.${tag}@example.com`, password: PW });
  await step("a logistics person joins with the company code and the administrator gives the Logistics role", async () => {
    let code = sql(`select coalesce(join_code, '') from public.tenants where slug = '${slug}'`);
    if (!code) {                                          // scenario 4 leaves the code off; the administrator switches it on again
      await go(o, `${base}/users`);
      await press(o, "Switch on", { wait: 1200 });
      code = sql(`select coalesce(join_code, '') from public.tenants where slug = '${slug}'`);
    }
    check(code, "the company code could not be switched on");
    await go(lg, `/join?code=${code}`);
    await fill(lg, "#full_name", "Naveed Iqbal"); await fill(lg, "#email", lg.email); await fill(lg, "#note", "Logistics.");
    await fill(lg, "#phone", phoneFor(lg.email)); await fill(lg, "#licence_no", "LHR-4455667"); await fill(lg, "#licence_expires_on", "2099-12-31");
    await fill(lg, "#password", PW); await fill(lg, "#confirm", PW);
    await lg.page.check("input[name=terms]");
    await press(lg, "Ask to join", { wait: 1500 });
    check(lg.page.url().includes("/join/sent"), `after asking: ${lg.page.url()} :: ${(await body(lg)).replace(/\s+/g, " ").slice(0, 400)}`);
    await confirmJoinOnWhatsApp(lg);
    const { code: confirm } = await confirmEmail(lg.email);
    await go(lg, `/auth/callback?code=${confirm}`);
    await waitText(lg, "Waiting for approval");
    await go(o, `${base}/users`);
    const item = o.page.locator("li", { hasText: "Naveed Iqbal" }).first();
    await item.locator("input[name=employee_no]").fill(`L-${tag}`);
    await item.locator("select[name=role]").selectOption("logistics");
    await item.locator("select[name=vehicle_scope]").selectOption("all");
    await press(o, item.getByRole("button", { name: "Approve" }), { wait: 1800 });
    await go(lg, "/");
    await waitText(lg, "Invitations waiting for you");
    await press(lg, /accept|join/i, { wait: 2500 });
    await lg.page.waitForURL(new RegExp(`/w/${slug}`), { timeout: 20000 });
    check(sql(`select role from public.tenant_memberships where user_id = '${await userId(lg.email)}'`) === "logistics", "wrong role");
  });

  await step("their vehicle list holds only Logistics vehicles, with nothing to filter and no way to add or import", async () => {
    await go(lg, `${base}/vehicles`);
    const t = await body(lg);
    check(has(t, mine1) && has(t, mine2), "their own vehicles are missing");
    check(!has(t, other), `another department's vehicle ${other} is on their list`);
    check(await lg.page.locator("select#dept").count() === 0, "they are offered a department filter with nothing to choose");
    check(!has(t, "Import data") && !has(t, "Add vehicle"), "they can add or import vehicles");
    await go(lg, `${base}/vehicles?dept=_none`);
    check(!has(await body(lg), other), "the no-department filter let the general fleet through");
  });

  await step("a vehicle of another department cannot be opened by its address", async () => {
    const id = sql(`select id from ${sch}.vehicles where registration_no = '${other}'`);
    const r = await go(lg, `${base}/vehicles/${id}`);
    check(r?.status() !== 200 || !has(await body(lg), other), `${other} opened for a logistics login (HTTP ${r?.status()})`);
  });

  await step("they cannot reach the cost reports, the import, or the export of other departments' vehicles", async () => {
    const rep = await go(lg, `${base}/reports`);
    check(rep?.status() !== 200 || !has(await body(lg), "Cost per kilometre"), "a logistics login reached the cost reports");
    const imp = await go(lg, `${base}/vehicles/import`);
    check(imp?.status() !== 200 || !has(await body(lg), "Import vehicles"), "a logistics login reached the vehicle import");
    const csv = await lg.page.evaluate(async (u) => (await fetch(u)).text(), `${base}/export/vehicles`);
    check(has(csv, "Department") && has(csv, mine1) && !has(csv, other), "the vehicles export leaks other departments");
  });

  await step("the Users page says the Logistics person sees Logistics vehicles only, not all vehicles", async () => {
    await go(o, `${base}/users`);
    const row = o.page.locator("tr", { hasText: "Logistics" }).filter({ hasText: lg.email.split("@")[0] }).first();
    const text = (await row.count()) ? await row.innerText() : await body(o);
    check(has(text, "Logistics vehicles only"), "the Users page does not say that a Logistics login sees Logistics vehicles only");
  });

  await step("with no vehicles in its department, a Logistics login is told why the lists look empty", async () => {
    sql(`set search_path = ${sch}, public; update vehicles set department = 'Operations' where lower(department) = 'logistics'`);          // nothing is left in Logistics for the moment
    try {
      await go(lg, `${base}/vehicles`);
      const t = await body(lg);
      check(has(t, "No vehicles yet") && has(t, "sees only vehicles in the Logistics department"), `the empty vehicle list does not explain itself: ${t.slice(0, 200)}`);
      await go(lg, `${base}/job-cards/new`);
      check(has(await body(lg), "sees only vehicles in the Logistics department"), "the new job card page does not explain why there is no vehicle to choose");
    } finally {
      sql(`set search_path = ${sch}, public; update vehicles set department = 'Logistics' where registration_no in ('${mine1}', '${mine2}')`);
    }
  });

  await step("by default Logistics handles the complete fleet: it sees every vehicle, and the Users page no longer says 'vehicles only'", async () => {
    sql(`set search_path = ${sch}, public; update role_departments set sees_all_vehicles = true where role_key = 'logistics'`);
    await go(lg, `${base}/vehicles`);
    const t = await body(lg);
    check(has(t, mine1) && has(t, mine2) && has(t, other), `Logistics does not see the whole fleet: ${t.slice(0, 200)}`);
    await go(o, `${base}/users`);
    check(!has(await body(o), "Logistics vehicles only"), "the Users page still says a whole-fleet Logistics login sees its vehicles only");
  });

  await step("a vehicle handed over the day its holder started changes holder at once (tenant 0043)", async () => {
    const vid = sql(`select id from ${sch}.vehicles where registration_no = '${other}'`);
    const e1 = sql(`set search_path = ${sch}, public; insert into employees(full_name, employee_no) values ('Holder One ${tag}', 'H1-${tag}') returning id`).split("\n").find((l) => /^[0-9a-f-]{36}$/.test(l));
    const e2 = sql(`set search_path = ${sch}, public; insert into employees(full_name, employee_no) values ('Holder Two ${tag}', 'H2-${tag}') returning id`).split("\n").find((l) => /^[0-9a-f-]{36}$/.test(l));
    sql(`set search_path = ${sch}, public; insert into vehicle_custody(vehicle_id, employee_id, from_date) values ('${vid}', '${e1}', current_date)`);
    await go(o, `${base}/vehicles/${vid}`);
    await o.page.locator("#employee_id").selectOption(e2);
    await press(o, "Change custody", { wait: 1500 });
    await waitText(o, `Holder Two ${tag}`, 8000);
    check(sql(`select employee_id from ${sch}.vehicle_custody where vehicle_id = '${vid}' and to_date is null`) === e2, "the new holder is not the current holder");
  });

  const issuesOfLogistics = (await import("./lib.mjs")).issues.get("logistics") ?? [];
  if (issuesOfLogistics.length) finding("quality", `browser problems for a logistics login: ${[...new Set(issuesOfLogistics)].slice(0, 3).join(" | ")}`);
}
