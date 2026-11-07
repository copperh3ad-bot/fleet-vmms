import { body, check, confirmEmail, fill, finding, go, has, persona, press, scenario, sql, step, uniq, userId, waitText } from "./lib.mjs";

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
  const [mine1, mine2, other] = ["LHR-1001", "LHR-1002", "DPT-3001"];
  await step("a third vehicle, for the general fleet, is added with the form", async () => {
    await go(o, `${base}/vehicles/new`);
    await fill(o, "#registration_no", other); await fill(o, "#make", "Suzuki"); await fill(o, "#model", "Bolan"); await fill(o, "#year", "2020");
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
    await fill(lg, "#password", PW); await fill(lg, "#confirm", PW);
    await lg.page.check("input[name=terms]");
    await press(lg, "Ask to join", { wait: 1500 });
    check(lg.page.url().includes("/join/sent"), `after asking: ${lg.page.url()} :: ${(await body(lg)).replace(/\s+/g, " ").slice(0, 400)}`);
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

  const issuesOfLogistics = (await import("./lib.mjs")).issues.get("logistics") ?? [];
  if (issuesOfLogistics.length) finding("quality", `browser problems for a logistics login: ${[...new Set(issuesOfLogistics)].slice(0, 3).join(" | ")}`);
}
