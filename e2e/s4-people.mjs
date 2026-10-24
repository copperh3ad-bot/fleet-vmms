import { body, check, confirmEmail, fill, finding, go, has, persona, press, scenario, signInAs, sql, step, uniq, userId, waitSql, waitText } from "./lib.mjs";

const PW = ["a", "long", "test", "password", "1"].join("-");
const schemaOf = (slug) => sql(`select schema_name from public.tenants where slug = '${slug}'`);

async function askToJoin(p, { path, code, name, email, shop }) {
  await go(p, `${path}?code=${code}`);
  if (shop) await fill(p, "#workshop_name", shop);
  await fill(p, "#full_name", name); await fill(p, "#email", email); await fill(p, "#note", "Please add me.");
  await fill(p, "#password", PW); await fill(p, "#confirm", PW);
  await p.page.check("input[name=terms]");
  await press(p, "Ask to join", { wait: 1500 });
}

export async function people(S) {
  scenario("4. Staff and workshops join a company with its code");
  const o = S.pk, slug = S.pkSlug, base = `/w/${slug}`, tag = uniq();
  check(o && slug, "scenarios 2 and 3 did not run");

  await step("the administrator switches on the company code and gets two links", async () => {
    await go(o, `${base}/users`);
    await press(o, "Switch on", { wait: 1200 });
    const code = (await o.page.locator("[aria-label='Company code']").first().innerText()).replace(/[^A-Z0-9]/g, "");
    check(/^[A-HJ-NP-Z2-9]{10}$/.test(code), `code looks like "${code}"`);
    S.code = code;
    const links = await o.page.locator("input[readonly]").evaluateAll((i) => i.map((x) => x.value));
    check(links.some((l) => l.endsWith(`/join?code=${code}`)) && links.some((l) => l.endsWith(`/join/workshop?code=${code}`)), `links: ${links.join(" ")}`);
    check(sql(`select join_code from public.tenants where slug = '${slug}'`) === code, "the code is not stored");
  });

  // ---------- staff
  S.staff = await persona("staff", { email: `staff.${tag}@example.com`, password: PW });
  await step("a member of staff asks to join with the code", async () => {
    await askToJoin(S.staff, { path: "/join", code: S.code, name: "Bilal Ahmed", email: S.staff.email });
    check(S.staff.page.url().includes("/join/sent"), `after asking: ${S.staff.page.url()}`);
    check(has(await body(S.staff), "Request sent"), "no confirmation");
    check(sql(`select count(*) from public.join_requests where tenant_id = (select id from public.tenants where slug = '${slug}') and status = 'pending' and email = '${S.staff.email}'`) === "1", "the request was not recorded");
  });
  await step("until the email is confirmed they cannot sign in, and nothing is built for them", async () => {
    await signInAs(S.staff);
    await waitText(S.staff, "do not match");
    check(sql(`select count(*) from public.tenant_memberships m join public.tenants t on t.id = m.tenant_id where t.slug = '${slug}'`) === "1", "someone was added before being approved");   // the owner only
  });
  await step("after confirming, the first page says the request is waiting for approval", async () => {
    const { code } = await confirmEmail(S.staff.email);
    await go(S.staff, `/auth/callback?code=${code}`);
    await waitText(S.staff, "Waiting for approval");
    check(has(await body(S.staff), "Lahore Fleet"), "does not name the company");
    check(!S.staff.page.url().includes("/w/"), "they were let into a workspace");
  });
  await step("the administrator sees a count on Users and roles, and a notification", async () => {
    await go(o, `${base}`);
    const badge = await o.page.locator("a[href$='/users']").first().innerText();
    check(/1/.test(badge), `sidebar says "${badge.replace(/\s+/g, " ")}"`);
    await go(o, `${base}/notifications`);
    await waitText(o, "Bilal Ahmed asked to join");
    await go(o, `${base}/users`);
    await waitText(o, "Asked to join");
    check(has(await body(o), "Please add me."), "the note is not shown");
  });
  await step("approving makes an invitation, which the person accepts to get in as a requester", async () => {
    const item = o.page.locator("li", { hasText: "Bilal Ahmed" }).first();
    await item.locator("select[name=role]").selectOption("requester");
    await press(o, item.getByRole("button", { name: "Approve" }), { wait: 1800 });
    await go(o, `${base}/users`);
    check(!has(await body(o), "Asked to join"), "the request is still listed after approval");
    await go(S.staff, "/");
    await waitText(S.staff, "Invitations waiting for you");
    await press(S.staff, /accept|join/i, { wait: 2500 });
    await S.staff.page.waitForURL(new RegExp(`/w/${slug}`), { timeout: 20000 });
    check(sql(`select role from public.tenant_memberships where user_id = '${await userId(S.staff.email)}'`) === "requester", "wrong role");
  });
  await step("the requester sees only what the role needs", async () => {
    const t = await body(S.staff);
    for (const w of ["Job cards", "Vehicles"]) check(has(t, w), `no "${w}"`);
    for (const w of ["Users and roles", "Service rules", "Billing"]) if (has(t, w)) finding("access", `a requester sees "${w}" in the navigation`);
    await go(S.staff, `${base}/users`);
    check(has(await body(S.staff), "do not have access") || !new URL(S.staff.page.url()).pathname.endsWith("/users"), "a requester opened the Users page");
    await go(S.staff, `${base}/billing`);
    check(!has(await body(S.staff), "I have paid"), "a requester can file a payment");
    await go(S.staff, `/admin`);
    check(!new URL(S.staff.page.url()).pathname.startsWith("/admin"), "a requester reached the operator pages");
  });
  await step("the requester can read the policy but not change it", async () => {
    await go(S.staff, `${base}/policy`);
    const t = await body(S.staff);
    check(has(t, "Fleet maintenance policy 2027"), "the current policy is not shown");
    check(await S.staff.page.locator("#policy-file").count() === 0, "an upload box is offered to a requester");
    check(!has(t, "Read this policy"), "the reading tool is offered to a requester");
  });

  S.mgr = await persona("manager", { email: `manager.${tag}@example.com`, password: PW });
  await step("a fleet manager joins through the same door, with the role the administrator chooses", async () => {
    await askToJoin(S.mgr, { path: "/join", code: S.code, name: "Farah Khan", email: S.mgr.email });
    const { code } = await confirmEmail(S.mgr.email);
    await go(S.mgr, `/auth/callback?code=${code}`);
    await waitText(S.mgr, "Waiting for approval");
    await go(o, `${base}/users`);
    const item = o.page.locator("li", { hasText: "Farah Khan" }).first();
    await item.locator("select[name=role]").selectOption("fleet_manager");
    await item.locator("select[name=vehicle_scope]").selectOption("all");
    await press(o, item.getByRole("button", { name: "Approve" }), { wait: 1800 });
    await go(S.mgr, "/");
    await waitText(S.mgr, "Invitations waiting for you");
    await press(S.mgr, /accept|join/i, { wait: 2500 });
    await S.mgr.page.waitForURL(new RegExp(`/w/${slug}`), { timeout: 20000 });
    check(sql(`select role from public.tenant_memberships where user_id = '${await userId(S.mgr.email)}'`) === "fleet_manager", "wrong role");
  });
  await step("the owner (administrator role) is not offered approval of job cards: only a manager approves", async () => {
    finding("design", "The company owner has the Administrator role, which cannot approve job cards (only Fleet manager can). A one-person company can raise a job card but never approve it until it adds a manager. Consider giving the Administrator the approval permission (the rule that nobody approves their own job already holds), or letting one person hold two roles.");
  });

  await step("a requester raises a job card for the vehicle they hold", async () => {
    const schema = schemaOf(slug);
    const emp = sql(`select id from "${schema}".employees where user_id = '${await userId(S.staff.email)}'`);
    const veh = sql(`select id from "${schema}".vehicles where registration_no = 'LHR-1002'`);
    check(emp && veh, "employee or vehicle missing");
    sql(`set search_path = "${schema}", public; insert into vehicle_custody(vehicle_id, employee_id, from_date) values ('${veh}', '${emp}', current_date)`);
    await go(S.staff, `${base}/job-cards/new`);
    const f = S.staff.page.locator("form:has(#cause_text)").last();
    await f.locator("#vehicle_id").selectOption({ index: 1 });
    await f.locator("#odometer_km").fill("43000");
    await f.locator("#reason_code_id").selectOption({ index: 2 });
    await f.locator("#cause_text").fill("Engine warning light came on during a long trip.");
    await f.locator("button[type=submit]").last().click();
    await S.staff.page.waitForLoadState("networkidle"); await S.staff.page.waitForTimeout(1500);
    check(/\/job-cards\/[0-9a-f-]{36}/.test(S.staff.page.url()), `requester's job card page: ${S.staff.page.url()}`);
    S.jobByStaff = new URL(S.staff.page.url()).pathname;
    check(sql(`select status from "${schema}".job_cards where id = '${S.jobByStaff.split("/").pop()}'`) === "submitted", "not submitted");
    check(sql(`select count(*) from "${schema}".job_card_events where job_card_id = '${S.jobByStaff.split("/").pop()}'`) >= "1", "the history has no events");
  });

  // ---------- workshop
  S.shop = await persona("workshop", { email: `shop.${tag}@example.com`, password: PW });
  await step("a workshop asks to join, with its own name", async () => {
    await askToJoin(S.shop, { path: "/join/workshop", code: S.code, name: "Imran Ali", email: S.shop.email, shop: `Speedy Auto ${tag}` });
    check(S.shop.page.url().includes("/join/sent"), `after asking: ${S.shop.page.url()}`);
    const { code } = await confirmEmail(S.shop.email);
    await go(S.shop, `/auth/callback?code=${code}`);
    await waitText(S.shop, "Waiting for approval");
  });
  await step("approving a workshop creates its record and an invitation, and it lands in the workshop portal", async () => {
    await go(o, `${base}/users`);
    const item = o.page.locator("li", { hasText: `Speedy Auto ${tag}` }).first();
    check(has(await item.innerText(), "Workshop"), "not marked as a workshop");
    await press(o, item.getByRole("button", { name: "Approve" }), { wait: 1800 });
    check(sql(`select count(*) from "${schemaOf(slug)}".vendors where name = 'Speedy Auto ${tag}'`) === "1", "no workshop record");
    await go(S.shop, "/");
    await waitText(S.shop, "Invitations waiting for you");
    await press(S.shop, /accept|join/i, { wait: 2500 });
    await S.shop.page.waitForURL(new RegExp(`/w/${slug}`), { timeout: 20000 });
    check(sql(`select role from public.tenant_memberships where user_id = '${await userId(S.shop.email)}'`) === "vendor", "wrong role");
  });
  await step("the workshop sees its portal and not the company's records", async () => {
    const t = await body(S.shop);
    check(has(t, "My work"), "no workshop portal");
    for (const p of ["/vehicles", "/users", "/billing", "/policy", "/budgets", "/employees"]) {
      await go(S.shop, `${base}${p}`);
      const bt = await body(S.shop);
      const u = new URL(S.shop.page.url()).pathname;
      check(has(bt, "do not have access") || !u.endsWith(p), `a workshop opened ${p}`);
    }
  });
  await step("the manager approves the job and assigns it to the workshop in one step, and the workshop then sees only that job", async () => {
    const schema = schemaOf(slug), jobId = S.jobByStaff.split("/").pop();
    await go(S.mgr, S.jobByStaff);
    await S.mgr.page.locator("label", { hasText: `Speedy Auto ${tag}` }).first().click();
    await press(S.mgr, /approve and assign/i, { wait: 1800 });
    await waitSql(`select status from "${schema}".job_cards where id = '${jobId}'`, "vendor_assigned");
    check(sql(`select count(*) from "${schema}".job_card_events where job_card_id = '${jobId}'`) >= "2", "the history did not record the decision");
    await go(S.shop, `${base}/vendor`);
    check(has(await body(S.shop), "JC-"), "the workshop does not see the job it was given");
    check(!has(await body(S.shop), "JC-000001"), "the workshop sees a job that was not given to it");
  });
  await step("a brand-new company cannot approve any job until it has a workshop (first-run friction)", async () => {
    finding("flow", "Approving a job card means choosing a workshop in the same step, and the company owner cannot approve at all. A new company therefore needs a manager and a workshop before its first job can move. Consider a first-run checklist (add a workshop, add a manager) or allowing approval without assignment.");
  });

  // ---------- decline, replacement, wrong code, limits
  await step("a declined request disappears, and the person may ask again", async () => {
    const d = await persona("declined", { email: `declined.${tag}@example.com`, password: PW });
    await askToJoin(d, { path: "/join", code: S.code, name: "Dana Declined", email: d.email });
    await go(o, `${base}/users`);
    const item = o.page.locator("li", { hasText: "Dana Declined" }).first();
    await press(o, item.getByRole("button", { name: "Decline" }), { wait: 1500 });
    await go(o, `${base}/users`);
    check(!has(await body(o), "Dana Declined"), "still listed after declining");
    await askToJoin(d, { path: "/join", code: S.code, name: "Dana Declined", email: d.email });
    check(d.page.url().includes("/join/sent"), "could not ask again");
    await d.ctx.close();
  });
  await step("a new code stops the old one at once", async () => {
    await go(o, `${base}/users`);
    await press(o, "Make a new code", { wait: 1500 });
    const fresh = (await o.page.locator("[aria-label='Company code']").first().innerText()).replace(/[^A-Z0-9]/g, "");
    check(fresh !== S.code, "the code did not change");
    const v = await persona("old-code");
    await askToJoin(v, { path: "/join", code: S.code, name: "Late Comer", email: `late.${tag}@example.com` });
    await waitText(v, "not recognised");
    await v.ctx.close();
    S.code = fresh;
  });
  await step("switching the code off closes joining, and switching on again makes a working code", async () => {
    await go(o, `${base}/users`);
    await press(o, "Switch off", { wait: 1500 });
    check(sql(`select join_code is null from public.tenants where slug = '${slug}'`) === "t", "code still stored");
    await press(o, "Switch on", { wait: 1500 });
    check(sql(`select join_code is not null from public.tenants where slug = '${slug}'`) === "t", "no new code");
  });
  await step("a request made with this company's code never shows up in the other company", async () => {
    await go(S.us, `/w/${S.usSlug}/users`);
    check(!has(await body(S.us), "Bilal Ahmed") && !has(await body(S.us), "Speedy Auto"), "another company's people are visible");
    check(sql(`select count(*) from public.join_requests where tenant_id = (select id from public.tenants where slug = '${S.usSlug}')`) === "0", "requests landed in the wrong company");
  });
  await step("trying many wrong codes is slowed down", async () => {
    sql("delete from public.rate_limits");
    const v = await persona("guesser");
    let limited = false;
    for (let i = 0; i < 13 && !limited; i++) {
      await askToJoin(v, { path: "/join", code: `ZZZZZZZZZ${"ABCDEFGHJKMNPQ"[i]}`, name: "Guess Work", email: `guess${i}.${tag}@example.com` });
      limited = has(await body(v), "Too many tries");
    }
    check(limited, "13 wrong codes in a row were all answered");
    await v.ctx.close();
    sql("delete from public.rate_limits");
  });
}
