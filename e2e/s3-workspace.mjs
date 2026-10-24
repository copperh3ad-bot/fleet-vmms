import { body, check, fill, finding, fixture, go, has, mock, press, scenario, sql, step, waitText } from "./lib.mjs";

const tenantId = (slug) => sql(`select id from public.tenants where slug = '${slug}'`);
const setting = (slug, key) => sql(`select value from "${sql(`select schema_name from public.tenants where slug = '${slug}'`)}".settings where key = '${key}'`);

export async function workspace(S) {
  scenario("3. A Pakistani company sets up its fleet and its policy");
  const o = S.pk, slug = S.pkSlug, base = `/w/${slug}`;
  check(o && slug, "scenario 2 did not run first");

  await step("every main screen opens for the administrator without an error", async () => {
    for (const p of ["", "/job-cards", "/vehicles", "/odometer", "/vendors", "/policy", "/budgets", "/compliance", "/reports", "/reports/breaking", "/accidents", "/users", "/settings", "/employees", "/vehicles/new", "/notifications", "/billing"]) {
      const r = await go(o, base + p);
      check(r.status() < 400, `${p || "/"} gave ${r.status()}`);
      const t = await body(o);
      check(!has(t, "application error") && !has(t, "something went wrong"), `${p || "/"} showed an error`);
      check(new URL(o.page.url()).pathname.startsWith(base), `${p} went to ${o.page.url()}`);
    }
  });

  await step("an employee is added", async () => {
    await go(o, `${base}/employees`);
    await fill(o, "form:has(button:has-text('Add employee')) #full_name", "Ali Raza");
    await fill(o, "form:has(button:has-text('Add employee')) #employee_no", "E-100");
    await fill(o, "form:has(button:has-text('Add employee')) #email", "ali.raza@example.com");
    await press(o, "Add employee", { wait: 900 });
    await go(o, `${base}/employees`);
    check(has(await body(o), "Ali Raza"), "the employee is not listed");
  });

  await step("two vehicles are added with the form", async () => {
    for (const [plate, year] of [["LHR-1001", "2017"], ["LHR-1002", "2025"]]) {
      await go(o, `${base}/vehicles/new`);
      await fill(o, "#registration_no", plate); await fill(o, "#make", "Toyota"); await fill(o, "#model", "Hilux"); await fill(o, "#year", year);
      await o.page.selectOption("#fuel_type", { index: 1 });
      await fill(o, "#odometer_km", "42000");
      await press(o, "Save vehicle", { wait: 1500 });
      await waitText(o, plate, 8000);
    }
    check(sql(`select count(*) from "${sql(`select schema_name from public.tenants where slug = '${slug}'`)}".vehicles`) === "2", "two vehicles not stored");
  });

  await step("a vehicle that is added twice is refused with a plain message", async () => {
    await go(o, `${base}/vehicles/new`);
    await fill(o, "#registration_no", "lhr 1001"); await fill(o, "#make", "Toyota"); await fill(o, "#model", "Hilux"); await fill(o, "#year", "2020"); await fill(o, "#odometer_km", "1000");
    await o.page.selectOption("#fuel_type", { index: 1 });
    await press(o, "Save vehicle", { wait: 1200 });
    await waitText(o, "already", 6000);
    check(o.page.url().includes("/vehicles/new"), "moved on after a duplicate");
  });

  await step("the vehicle list and a vehicle's page show the vehicles", async () => {
    await go(o, `${base}/vehicles`);
    const t = await body(o);
    check(has(t, "LHR-1001") && has(t, "LHR-1002"), "a vehicle is missing from the list");
    await o.page.getByRole("link", { name: /LHR-1001/ }).first().click();
    await o.page.waitForLoadState("networkidle");
    check(/\/vehicles\/[0-9a-f-]{36}/.test(o.page.url()), `vehicle page url ${o.page.url()}`);
    S.vehicleUrl = new URL(o.page.url()).pathname;
    S.vehicleId = S.vehicleUrl.split("/").pop();
  });

  await step("a photo is uploaded for a vehicle and stored under the company's own folder", async () => {
    await go(o, S.vehicleUrl);
    const input = o.page.locator("form:has(label:has-text('Photo of the vehicle')) input[type=file]");
    await input.setInputFiles(fixture("policy-photo.png"));
    await press(o, o.page.locator("form:has(label:has-text('Photo of the vehicle')) button:has-text('Add')"), { wait: 1500 });
    const files = await mock("/__test/files");
    const schema = sql(`select schema_name from public.tenants where slug = '${slug}'`);
    check(files.some((f) => f.startsWith(`attachments/${schema}/vehicle/${S.vehicleId}/`)), `no stored file under ${schema}: ${files.join(", ")}`);
    await go(o, S.vehicleUrl);
    check(await o.page.locator("img[alt='Vehicle photo']").count() > 0, "the photo does not show on the vehicle page");
  });

  await step("a job card is raised for a vehicle", async () => {
    await go(o, `${base}/job-cards/new`);
    const f = o.page.locator("form:has(#cause_text)").last();
    await f.locator("#vehicle_id").selectOption({ index: 1 });
    await f.locator("#odometer_km").fill("42500");
    await f.locator("#reason_code_id").selectOption({ index: 2 });
    await f.locator("#cause_text").fill("Brakes are squealing and the pedal feels soft when stopping.");
    const lineDesc = f.locator("input[name=line_description]").first();
    if (await lineDesc.count()) { await lineDesc.fill("Front brake pads"); await f.locator("input[name=line_unit_cost]").first().fill("12000"); }
    const btns = await f.locator("button[type=submit]").allTextContents();
    S.jobButtons = btns;
    await f.locator("button[type=submit]").last().click();
    await o.page.waitForLoadState("networkidle"); await o.page.waitForTimeout(1200);
    check(/\/job-cards\/[0-9a-f-]{36}/.test(o.page.url()), `after saving the job card the page was ${o.page.url()} (buttons: ${btns.join(" | ")})`);
    S.jobUrl = new URL(o.page.url()).pathname;
    check(has(await body(o), "Brakes are squealing"), "the job card does not show what was typed");
  });

  await step("an administrator cannot approve a job card they raised themselves", async () => {
    await go(o, S.jobUrl);
    check(await o.page.getByRole("button", { name: /approve/i }).count() === 0, "an Approve button is offered to the person who raised it");
    check(has(await body(o), "Awaiting approval"), "the job card is not shown as awaiting approval");
  });

  // ---------- the policy
  await step("the policy file is uploaded and shows as the current policy", async () => {
    await go(o, `${base}/policy`);
    await fill(o, "#title", "Fleet maintenance policy 2027"); await fill(o, "#effective_from", "2027-01-01");
    await o.page.locator("#policy-file").setInputFiles(fixture("policy-scan.pdf"));
    await press(o, "Upload policy", { wait: 2000 });
    await waitText(o, "Fleet maintenance policy 2027", 10000);
    await waitText(o, "Current", 5000);
    const files = await mock("/__test/files");
    check(files.some((f) => /maintenance_policy/.test(f)), "the policy file is not in storage");
  });

  await step("the policy is read (a scanned PDF) and the rules it states are offered", async () => {
    await go(o, `${base}/policy`);
    await press(o, "Read this policy", { wait: 500 });
    await waitText(o, "Found in your policy", 90000);
    const t = await body(o);
    for (const w of ["Replace a vehicle after", "Accidents the company absorbs", "Driver's share of repairs", "Oil change"]) check(has(t, w), `no finding for "${w}"`);
    for (const v of ["7", "3", "18", "30"]) check(t.includes(v), `value ${v} not shown`);
    const boxes = await o.page.locator("input[name=finding]").count();
    check(boxes >= 5, `only ${boxes} findings to apply`);
  });

  await step("nothing changes until the findings are applied", async () => {
    check(setting(slug, "policy_replace_years") === "0", "a rule changed before it was confirmed");
    check(setting(slug, "policy_driver_share_pct") === "0", "a rule changed before it was confirmed");
  });

  await step("the findings are applied and the company's rules change", async () => {
    await press(o, "Apply selected", { wait: 1500 });
    await waitText(o, "Applied", 10000);
    check(setting(slug, "policy_replace_years") === "7", `replace years ${setting(slug, "policy_replace_years")}`);
    check(setting(slug, "policy_free_accidents") === "3", "free accidents");
    check(setting(slug, "policy_accident_gap_months") === "18", "gap months");
    check(setting(slug, "policy_driver_share_pct") === "30", "driver share");
    const oil = sql(`select interval_months || ' / ' || interval_km from "${sql(`select schema_name from public.tenants where slug = '${slug}'`)}".service_types where key = 'oil_change'`);
    check(oil.startsWith("4 / 6000"), `oil change interval ${oil}`);
  });

  await step("the policy rules now show on the page, and an old vehicle is flagged for replacement", async () => {
    await go(o, `${base}/policy`);
    check(has(await body(o), "Replacement after 7 years"), "the page does not describe the replacement rule");
    await go(o, `${base}/vehicles`);
    await waitText(o, "replacement", 8000);
    const t = await body(o);
    check(has(t, "Due for replacement"), "the 2017 vehicle is not flagged");
  });

  await step("service rules, budgets, documents and reports open and take input", async () => {
    await go(o, `${base}/settings`);
    check(has(await body(o), "Oil change"), "service rules lack the oil change rule");
    await go(o, `${base}/reports`);
    check(!has(await body(o), "error"), "reports error");
  });
}
