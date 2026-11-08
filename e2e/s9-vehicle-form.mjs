// The add-vehicle drop-downs must keep what a person picks: while filling the form, and after the server sends the form back with a message (ADR-070 is checked here too).
import { body, check, fill, go, has, press, scenario, sql, step, waitText } from "./lib.mjs";

const shown = (o) => o.page.evaluate(() => Object.fromEntries(["make", "model", "year", "fuel_type", "vehicle_class", "employee_id"].map((id) => {
  const el = document.getElementById(id) ?? document.querySelector(`[name=${id}]`);
  return [id, el ? (el.options ? el.options[el.selectedIndex]?.text ?? "" : el.value) : "(none)"];
})));

export async function vehicleForm(S) {
  scenario("9. The add-vehicle drop-downs keep what is picked");
  const o = S.pk, slug = S.pkSlug, base = `/w/${slug}`;
  check(o && slug, "scenario 2 did not run first");

  await step("each drop-down holds the pick while the form is being filled", async () => {
    await go(o, `${base}/vehicles/new`);
    await o.page.selectOption("#make", "Toyota");
    check((await shown(o)).make === "Toyota", "the make did not stay");
    await o.page.selectOption("#model", "Hilux");
    check((await shown(o)).model === "Hilux", "the model did not stay");
    await o.page.selectOption("#year", "2019");
    await o.page.selectOption("#fuel_type", "diesel");
    await o.page.selectOption("#vehicle_class", "van");
    await fill(o, "#registration_no", "");                     // the plate is left empty on purpose
    const s = await shown(o);
    check(s.year === "2019" && /diesel/i.test(s.fuel_type) && /van/i.test(s.vehicle_class), `a pick did not stay: ${JSON.stringify(s)}`);
  });

  await step("the picks are still there after the form comes back with a message", async () => {
    await press(o, "Save vehicle", { wait: 1500 });
    await waitText(o, "plate", 6000).catch(() => undefined);
    const s = await shown(o);
    check(s.make === "Toyota" && s.model === "Hilux", `make and model were cleared: ${JSON.stringify(s)}`);
    check(s.year === "2019", `the year was cleared: ${JSON.stringify(s)}`);
    check(/diesel/i.test(s.fuel_type), `the fuel was cleared: ${JSON.stringify(s)}`);
    check(/van/i.test(s.vehicle_class), `the class was cleared: ${JSON.stringify(s)}`);
  });

  await step("a pick can be changed after the message, and then holds", async () => {
    await o.page.selectOption("#model", { index: 2 });
    const first = (await shown(o)).model;
    await o.page.selectOption("#make", "Suzuki");
    const s = await shown(o);
    check(s.make === "Suzuki", `the new make did not hold: ${JSON.stringify(s)}`);
    check(s.model !== first, "the model list did not follow the make");
  });

  // The same flaw was in every form that keeps a pick in React state and is sent as <form action>: after an error the browser put each drop-down back on its first option.
  await step("the job card form keeps the vehicle and reason after an error", async () => {
    await go(o, `${base}/job-cards/new`);
    const f = o.page.locator("form:has(#cause_text)").last();
    await f.locator("#vehicle_id").selectOption({ index: 1 });
    await f.locator("#reason_code_id").selectOption({ index: 2 });
    const before = [await f.locator("#vehicle_id").inputValue(), await f.locator("#reason_code_id").inputValue()];
    check(before[0] !== "" && before[1] !== "", "the picks did not take");
    await f.locator("#cause_text").fill("");                              // what was seen is left empty on purpose
    await f.locator("button[type=submit]").last().click();
    await o.page.waitForTimeout(2000);
    check((await body(o)).length > 0 && o.page.url().includes("/job-cards/new"), "the form did not stay on the page");
    const after = [await f.locator("#vehicle_id").inputValue(), await f.locator("#reason_code_id").inputValue()];
    check(after[0] === before[0] && after[1] === before[1], `a pick was cleared after the error: ${JSON.stringify({ before, after })}`);
  });

  await step("the accident form keeps the vehicle and severity after an error", async () => {
    await go(o, `${base}/accidents`);
    const f = o.page.locator("form:has(#occurred_at)").first();
    await f.locator("#vehicle_id").selectOption({ index: 1 });
    await f.locator("select[name=severity]").selectOption("minor");
    const before = await f.locator("#vehicle_id").inputValue();
    await f.locator("button[type=submit]").last().click();                // the date and the description are empty on purpose
    await o.page.waitForTimeout(2000);
    check((await f.locator("#vehicle_id").inputValue()) === before, "the vehicle was cleared after the error");
    check((await f.locator("select[name=severity]").inputValue()) === "minor", "the severity was cleared after the error");
  });

  await step("the document form keeps the vehicle and document type after an error", async () => {
    await go(o, `${base}/compliance/new`);
    const f = o.page.locator("form:has(#doc_type)").first();
    await f.locator("select[name=vehicle_id]").selectOption({ index: 1 });
    await f.locator("#doc_type").selectOption("insurance");
    const before = await f.locator("select[name=vehicle_id]").inputValue();
    await f.locator("button[type=submit]").last().click();                // the expiry date is empty on purpose
    await o.page.waitForTimeout(2000);
    check((await f.locator("select[name=vehicle_id]").inputValue()) === before, "the vehicle was cleared after the error");
    check((await f.locator("#doc_type").inputValue()) === "insurance", "the document type was cleared after the error");
  });

  await step("a vehicle with an insurance expiry date but no policy number saves (it returned a server error on the live site)", async () => {
    await go(o, `${base}/vehicles/new`);
    await fill(o, "#registration_no", "INS-4040");
    await o.page.selectOption("#make", "Toyota"); await o.page.selectOption("#model", "Hilux"); await o.page.selectOption("#year", "2021");
    await o.page.selectOption("#fuel_type", { index: 1 });
    await fill(o, "#odometer_km", "15000");
    await fill(o, "#insurance_valid_to", "2027-03-31");
    await fill(o, "#doc_fitness_expires", "2027-06-30");
    await fill(o, "#doc_token_tax_expires", "2027-06-30");
    await fill(o, "#budget_amount", "400000");          // the QA report's exact combination: documents, insurance and a budget in one submit
    await press(o, "Save vehicle", { wait: 1500 });
    await waitText(o, "INS-4040", 8000);
    const schema = sql(`select schema_name from public.tenants where slug = '${slug}'`);
    check(sql(`select p.insurer || '/' || p.policy_no from "${schema}".insurance_policies p join "${schema}".vehicles v on v.id = p.vehicle_id where v.registration_no = 'INS-4040'`) === "Not recorded yet/Not recorded yet", "the insurance was not stored with the placeholders");
  });

  await step("an unlisted make and model are saved at once, sent for review, and offered back to the company", async () => {
    await go(o, `${base}/vehicles/new`);
    await fill(o, "#registration_no", "ZOT-777");
    await o.page.selectOption("#make", "__other");
    await o.page.locator("input[name=make_other]").fill("Zotye");
    await o.page.locator("input[name=model_other]").fill("T600");
    await o.page.selectOption("#year", "1998");
    await o.page.selectOption("#fuel_type", { index: 1 });
    await fill(o, "#odometer_km", "120000");
    await press(o, "Save vehicle", { wait: 1500 });
    await waitText(o, "ZOT-777", 8000);
    const schema = sql(`select schema_name from public.tenants where slug = '${slug}'`);
    check(sql(`select make || '/' || model from "${schema}".vehicles where registration_no = 'ZOT-777'`) === "Zotye/T600", "the vehicle was not saved with the typed name");
    check(sql("select string_agg(make || '/' || coalesce(model, '-') || '/' || status, ',' order by model nulls first) from public.vehicle_name_suggestions where make_key = 'zotye'") === "Zotye/-/pending,Zotye/T600/pending", "the names were not sent for review");
    await go(o, `${base}/vehicles/new`);
    const makes = await o.page.locator("#make option").allTextContents();
    check(makes.includes("Zotye"), "the company's own name is not in its list");
    await o.page.selectOption("#make", "Zotye");
    check((await o.page.locator("#model option").allTextContents()).includes("T600"), "the company's own model is not in its list");
  });

  await step("the operator approves it from the review screen and it reaches another company's list", async () => {
    const op = S.op;
    await go(op, "/admin/vehicle-names");
    check(has(await body(op), "Zotye T600"), "the name is not in the review queue");
    await op.page.locator("section:has-text('Zotye T600') button:has-text('Approve')").click();
    await waitText(op, "Approved", 8000);
    check(sql("select count(*) from public.vehicle_name_suggestions where make_key = 'zotye' and status = 'approved'") === "2", "the make and the model were not both approved");
    await go(S.us, `/w/${S.usSlug}/vehicles/new`);
    check((await S.us.page.locator("#make option").allTextContents()).includes("Zotye"), "the approved make is not in another company's list");
    check(!has(await body(S.us), "Awaiting"), "unexpected text");
  });

  await step("the activity log has this session's actions, sign-ins and a page view, and no secret", async () => {
    const rows = sql("select kind || ':' || name || ':' || outcome from public.activity_log order by id");
    check(rows.length > 0, "the activity log is empty");
    const text = rows.toLowerCase();
    check(text.includes("auth:sign in:ok"), "no sign-in line");
    check(text.includes("page:view:ok"), "no page view line");
    check(/action:\w+:(ok|invalid)/.test(text), "no action line");
    const leak = sql("select count(*) from public.activity_log where details::text ~* 'eyJ[a-z0-9_-]{10,}' or error_message ~* '(password=|eyJ[a-z0-9_-]{10,})' or details::text ~* '\"(password|token|secret)\": \"[^\\[]'");
    check(leak === "0", "a secret-looking value is in the log");
    const unnamed = sql("select count(*) from public.activity_log where kind = 'action' and (name = 'action' or name ~ '^[a-z]{1,2}$')");
    check(unnamed === "0", `${unnamed} action lines have no readable name: ${sql("select string_agg(distinct name, ',') from public.activity_log where kind = 'action'")}`);
    const buildNoise = sql("select count(*) from public.activity_log where error_message ilike '%during prerendering%'");
    check(buildNoise === "0", "the build wrote to the activity log");
  });
}
