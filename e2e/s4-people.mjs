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
    await item.locator("input[name=employee_no]").fill(`B-${tag}`);
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
    check(has(t, "Job cards"), `no "Job cards"`);
    check(has(t, "What your vehicle has cost"), "the dashboard has no costs for the person's own vehicle");
    const nav = (await S.staff.page.locator('nav[aria-label="Workspace"]').allInnerTexts()).join(" ");
    for (const w of ["Vehicles", "Maintenance policy", "Budgets", "Compliance", "Reports", "Odometer"]) check(!has(nav, w), `a person limited to their own vehicle sees "${w}" in the navigation`);
    for (const w of ["Users and roles", "Service rules", "Billing"]) if (has(t, w)) finding("access", `a requester sees "${w}" in the navigation`);
    await go(S.staff, `${base}/users`);
    check(has(await body(S.staff), "do not have access") || !new URL(S.staff.page.url()).pathname.endsWith("/users"), "a requester opened the Users page");
    await go(S.staff, `${base}/billing`);
    check(!has(await body(S.staff), "I have paid"), "a requester can file a payment");
    await go(S.staff, `/admin`);
    check(!new URL(S.staff.page.url()).pathname.startsWith("/admin"), "a requester reached the operator pages");
  });
  await step("a person limited to their own vehicle cannot open the vehicle list or the policy by typing the address", async () => {
    for (const p of ["/vehicles", "/policy", "/reports", "/budgets", "/compliance", "/odometer"]) {
      await go(S.staff, `${base}${p}`);
      const t = await body(S.staff);
      check(has(t, "do not have access") || has(t, "not allowed") || !new URL(S.staff.page.url()).pathname.endsWith(p), `${p} opened for a person limited to their own vehicle`);
      check(!has(t, "Fleet maintenance policy 2027"), `${p} showed the company policy`);
    }
  });

  S.mgr = await persona("manager", { email: `manager.${tag}@example.com`, password: PW });
  await step("a fleet manager joins through the same door, with the role the administrator chooses", async () => {
    await askToJoin(S.mgr, { path: "/join", code: S.code, name: "Farah Khan", email: S.mgr.email });
    const { code } = await confirmEmail(S.mgr.email);
    await go(S.mgr, `/auth/callback?code=${code}`);
    await waitText(S.mgr, "Waiting for approval");
    await go(o, `${base}/users`);
    const item = o.page.locator("li", { hasText: "Farah Khan" }).first();
    await item.locator("input[name=employee_no]").fill(`F-${tag}`);
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
  // ---------- a person with no email (ADR-025)
  const PW2 = ["a", "new", "test", "password", "2"].join("-");
  const CODE = "482915", WRONG = "159263";
  const noMail = { code: `NE-${tag}`, name: "Noor Driver", user: `${slug}.ne-${tag}`.toLowerCase() };
  let linkPath = "";
  const nd = await persona("noemail");
  const landed = async (who) => {
    try { await who.page.waitForURL(new RegExp(`/w/${slug}`), { timeout: 15000 }); }
    catch { throw new Error(`stayed on ${who.page.url()}: ${(await body(who)).replace(/\s+/g, " ").slice(-350)}`); }
  };
  await step("an administrator invites someone with no email: employee code, role and a sign-in name, and gets a link to hand over", async () => {
    await go(o, `${base}/users`);
    const f = o.page.locator("form:has(#employee_no)").first();
    await f.locator("#employee_no").fill(noMail.code);
    await f.locator("#full_name").fill(noMail.name);
    await f.locator("#role").selectOption("requester");
    await f.getByLabel("With a sign-in name (no email)").check();
    await press(o, "Create invitation", { wait: 1200 });
    check(has(await body(o), "Enter their phone number"), "an invitation with no phone number was accepted");
    await f.locator("#full_name").fill(noMail.name); await f.locator("#phone").fill("12345"); await press(o, "Create invitation", { wait: 1200 });   // the form clears its text boxes after a failed try
    const widths = await o.page.evaluate(() => ["employee_no", "full_name", "role", "phone"].map((id) => document.getElementById(id)?.offsetWidth ?? 0));
    check(widths.every((w) => w > 150), `the invite form is squeezed: field widths ${widths.join(", ")}`);
    check(has(await body(o), "Start the number with 0") || has(await body(o), "wrong length") || has(await body(o), "Pakistani"), `a bad phone number was accepted: ${(await o.page.locator("[role=alert], [role=status]").allInnerTexts()).join(" | ")} // phone=${await f.locator("#phone").inputValue()}`);
    await f.locator("#full_name").fill(noMail.name); await f.locator("#phone").fill("0300-1234567");
    const shown = await f.locator("#username").inputValue();
    check(shown === noMail.user, `the suggested sign-in name was "${shown}", wanted "${noMail.user}"`);
    await press(o, "Create invitation", { wait: 2000 });
    check(has(await body(o), "Their sign-in name is") && has(await body(o), noMail.user), `no sign-in name shown: ${(await body(o)).slice(0, 200)}`);
    // The link is sent to the phone number only: the box offers WhatsApp and a text message to that number, and nothing else.
    const box = o.page.locator("div", { hasText: "goes to this number only" }).last();
    check(has(await box.innerText(), "0300 1234567"), "the number is not shown for checking");
    const wa = await o.page.getByRole("link", { name: "Send on WhatsApp" }).first().getAttribute("href");
    const sms = await o.page.getByRole("link", { name: "Send as a text message" }).first().getAttribute("href");
    check(/^https:\/\/wa\.me\/923001234567\?text=/.test(wa ?? ""), `the WhatsApp link was ${wa}`);
    check(/^sms:\+923001234567\?&body=/.test(sms ?? ""), `the text message link was ${sms}`);
    check(await o.page.locator('input[aria-label="Invitation link"]').count() === 0, "the link is shown on screen");
    check(!has(await body(o), "Copy link") && !has(await body(o), "Email it"), "there is a way to copy or email the link");
    const url = (decodeURIComponent(new URL(wa).searchParams.get("text") ?? "").match(/https?:\/\/\S+\/invite\/[A-Za-z0-9_-]{43}/) ?? [""])[0];
    linkPath = url ? new URL(url).pathname : "";
    check(/^\/invite\/[A-Za-z0-9_-]{43}$/.test(linkPath), `the link was ${url}`);
    check(sql(`select count(*) from "public".invitations where username = '${noMail.user}' and email is null and employee_no = '${noMail.code}'`) === "1", "the invitation was not stored with the sign-in name and code");
  });
  await step("the person opens the link, sees their sign-in name, chooses a password, and lands in the workspace", async () => {
    await go(nd, linkPath);
    check(has(await body(nd), "Your sign-in name") && has(await nd.page.locator("#identity").inputValue(), noMail.user), "the page does not show the sign-in name");
    check(await nd.page.locator("#email").count() === 0, "an email box is shown to someone with no email");
    await fill(nd, "#password", "short"); await fill(nd, "#confirm", "short");
    await press(nd, "Create my account", { wait: 1200 });
    check(has(await body(nd), "at least 10"), "a short password was accepted");
    await fill(nd, "#password", PW); await fill(nd, "#confirm", PW);
    await fill(nd, "#recovery", "111111"); await fill(nd, "#recovery_confirm", "111111");
    await press(nd, "Create my account", { wait: 1200 });
    check(has(await body(nd), "too easy"), "a trivial recovery code was accepted");
    await fill(nd, "#password", PW); await fill(nd, "#confirm", PW);
    await fill(nd, "#recovery", CODE); await fill(nd, "#recovery_confirm", "482916");
    await press(nd, "Create my account", { wait: 1200 });
    check(has(await body(nd), "recovery codes do not match"), "two different recovery codes were accepted");
    await fill(nd, "#password", PW); await fill(nd, "#confirm", PW);
    await fill(nd, "#recovery", CODE); await fill(nd, "#recovery_confirm", CODE);
    await press(nd, "Create my account", { wait: 3000 });
    await landed(nd);
    check(sql(`select recovery_hash like 's1$%' and recovery_hash not like '%${CODE}%' from public.login_names where username = '${noMail.user}'`) === "t", "the recovery code is not stored as a hash");
    check(sql(`select count(*) from public.login_names where username = '${noMail.user}' and login_email like '%@login.fleetotg.com'`) === "1", "no sign-in name was recorded");
    check(sql(`select count(*) from "${schemaOf(slug)}".employees where employee_no = '${noMail.code}' and user_id is not null`) === "1", "the login was not linked to the employee code");
    check(sql(`select role || '|' || vehicle_scope from public.tenant_memberships m join public.login_names l on l.user_id = m.user_id where l.username = '${noMail.user}'`) === "requester|own", "wrong role or vehicle scope");
    const again = await go(nd, linkPath);
    check(has(await body(nd), "not working"), `the link still works after use (${again?.status()})`);
  });
  await step("they sign in later with the sign-in name and password; a wrong password gives the one plain message", async () => {
    await nd.ctx.clearCookies();
    await go(nd, "/login");
    await fill(nd, "#email", noMail.user.toUpperCase()); await fill(nd, "#password", "not-the-password-1");
    await press(nd, "Sign in", { exact: true, wait: 1500 });
    check(has(await body(nd), "do not match"), "a wrong password was not refused");
    await fill(nd, "#email", noMail.user); await fill(nd, "#password", PW);   // the form clears itself after a failed try
    await press(nd, "Sign in", { exact: true, wait: 3000 });
    await landed(nd);
    const ghost = await persona("ghost");
    await go(ghost, "/login"); await fill(ghost, "#email", `nobody.${tag}`); await fill(ghost, "#password", PW);
    await press(ghost, "Sign in", { exact: true, wait: 1500 });
    check(has(await body(ghost), "do not match"), "an unknown sign-in name gave a different answer");
    await ghost.ctx.close();
  });
  await step("the administrator makes a password reset link for them; it works once and the old password stops working", async () => {
    await go(o, `${base}/users`);
    const row = o.page.locator("tr", { hasText: noMail.name }).first();
    check(has(await row.innerText(), noMail.code) && has(await row.innerText(), noMail.user), "the people list does not show the employee code and sign-in name");
    await press(o, row.getByRole("button", { name: "Make a password reset link" }), { wait: 2000 });
    const wa = await o.page.getByRole("link", { name: "Send on WhatsApp" }).first().getAttribute("href");
    check(/^https:\/\/wa\.me\/923001234567\?text=/.test(wa ?? ""), `the reset link was not addressed to the person's phone: ${wa}`);
    const url = (decodeURIComponent(new URL(wa).searchParams.get("text") ?? "").match(/https?:\/\/\S+\/invite\/[A-Za-z0-9_-]{43}/) ?? [""])[0];
    const reset = new URL(url).pathname;
    await nd.ctx.clearCookies();
    await go(nd, reset);
    check(has(await body(nd), "Choose a new password") && has(await body(nd), "Your recovery code"), "the reset page does not ask for the recovery code");
    await fill(nd, "#password", "an-admins-own-choice-9"); await fill(nd, "#confirm", "an-admins-own-choice-9"); await fill(nd, "#recovery", WRONG);
    await press(nd, "Save my new password", { wait: 2500 });
    check(has(await body(nd), "recovery code is not right"), "a reset with the wrong recovery code was not refused");
    check(!/\/w\//.test(nd.page.url()), "a reset with the wrong recovery code let the person in");
    await fill(nd, "#password", PW2); await fill(nd, "#confirm", PW2); await fill(nd, "#recovery", CODE);
    await press(nd, "Save my new password", { wait: 3000 });
    await landed(nd);
    await go(nd, reset);
    check(has(await body(nd), "not working"), "the reset link worked twice");
    await nd.ctx.clearCookies();
    await go(nd, "/login"); await fill(nd, "#email", noMail.user); await fill(nd, "#password", PW);
    await press(nd, "Sign in", { exact: true, wait: 1500 });
    check(has(await body(nd), "do not match"), "the old password still works");
    await fill(nd, "#email", noMail.user); await fill(nd, "#password", PW2);
    await press(nd, "Sign in", { exact: true, wait: 3000 });
    await landed(nd);
    await nd.ctx.close();
  });
  await step("an administrator can replace a login for someone who forgot everything: the old sign-in stops working and the employee code is free", async () => {
    sql("delete from public.rate_limits");
    await go(o, `${base}/users`);
    const row = o.page.locator("tr", { hasText: noMail.name }).first();
    o.page.once("dialog", (d) => d.accept());
    await press(o, row.getByRole("button", { name: "Replace login" }), { wait: 2500 });
    check(has(await body(o), "Login replaced"), `no confirmation: ${(await body(o)).slice(0, 200)}`);
    check(sql(`select count(*) from public.login_names where username = '${noMail.user}'`) === "0", "the sign-in name is still taken");
    check(sql(`select count(*) from "${schemaOf(slug)}".employees where employee_no = '${noMail.code}' and user_id is null`) === "1", "the employee code is not free");
    const stranger = await persona("replaced");
    await go(stranger, "/login"); await fill(stranger, "#email", noMail.user); await fill(stranger, "#password", PW2);
    await press(stranger, "Sign in", { exact: true, wait: 1500 });
    check(has(await body(stranger), "do not match"), "the replaced login still works");
    await stranger.ctx.close();
  });
}
