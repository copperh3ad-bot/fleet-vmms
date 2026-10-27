import { APP, axe, body, check, confirmEmail, fill, finding, go, has, persona, press, scenario, signInAs, signUpCompany, sql, step, uniq, userId, waitText } from "./lib.mjs";

const PW = "a-long-test-password-1";

export async function companies(S) {
  scenario("2. A company signs up: Pakistan, abroad, and the operator");
  const tag = uniq();

  // ---------- Pakistan
  S.pk = await persona("pk-owner", { email: `owner.pk.${tag}@example.com`, password: PW });
  await step("a company in Pakistan signs up, confirms its email and lands in its own workspace", async () => {
    S.pkName = `Lahore Fleet ${tag}`;
    S.pkSlug = await signUpCompany(S.pk, { name: S.pkName, person: "Sana Malik", email: S.pk.email, password: PW, country: "PK" });
    check(/^lahore-fleet/.test(S.pkSlug), `odd address ${S.pkSlug}`);
    return S.pkSlug;
  });
  await step("the new workspace shows the trial, and is empty and usable", async () => {
    const t = await body(S.pk);
    check(has(t, "trial"), "no mention of the trial");
    check(has(t, "Lahore Fleet"), "company name missing");
    check(!has(t, "application error"), "an error page");
  });
  await step("its tax record has the country it chose, and its trial is 3 days at USD 149", async () => {
    check(sql(`select country from public.org_tax where tenant_id = (select id from public.tenants where slug = '${S.pkSlug}')`) === "PK", "country not stored");
    const b = sql(`select status, price_cents, currency, round(extract(epoch from trial_ends_at - now())/3600) from public.org_billing where tenant_id = (select id from public.tenants where slug = '${S.pkSlug}')`);
    check(/^trialing\|14900\|USD\|7[12]$/.test(b), `billing row ${b}`);
  });
  await step("the owner is the administrator, and the workspace is its own schema", async () => {
    const r = sql(`select m.role, t.db_kind, t.provision_state from public.tenant_memberships m join public.tenants t on t.id = m.tenant_id where t.slug = '${S.pkSlug}'`);
    check(r === "tenant_admin|shared|ready", r);
  });

  // ---------- abroad
  S.us = await persona("us-owner", { email: `owner.us.${tag}@example.com`, password: PW });
  await step("a company outside Pakistan signs up the same way", async () => {
    S.usName = `Texas Haulage ${tag}`;
    S.usSlug = await signUpCompany(S.us, { name: S.usName, person: "Dana Reyes", email: S.us.email, password: PW, country: "US" });
    check(sql(`select country from public.org_tax where tenant_id = (select id from public.tenants where slug = '${S.usSlug}')`) === "US", "country not stored");
  });
  await step("the two companies have separate schemas", async () => {
    const r = sql(`select count(distinct schema_name) from public.tenants where slug in ('${S.pkSlug}', '${S.usSlug}')`);
    check(r === "2", `schemas: ${r}`);
  });

  // ---------- the operator (the owner of the platform is also just a user until made an operator)
  S.op = await persona("operator", { email: `operator.${tag}@example.com`, password: PW });
  await step("the operator signs up, then is made an operator", async () => {
    S.opSlug = await signUpCompany(S.op, { name: `Platform Owner ${tag}`, person: "Platform Owner", email: S.op.email, password: PW, country: "PK" });
    const id = await userId(S.op.email);
    sql(`insert into public.platform_admins(user_id) values ('${id}') on conflict do nothing`);
    await go(S.op, "/admin");
    check(new URL(S.op.page.url()).pathname === "/admin", `operator page went to ${S.op.page.url()}`);
  });
  await step("an ordinary customer is turned away from the operator pages", async () => {
    for (const p of ["/admin", "/admin/accounting", "/admin/tax", "/admin/rates", "/admin/payments", "/admin/settings"]) {
      await go(S.pk, p);
      check(!new URL(S.pk.page.url()).pathname.startsWith("/admin"), `${p} let a customer in (${S.pk.page.url()})`);          // they end up in their own workspace
    }
  });

  // ---------- sign in / out
  await step("signing out and back in goes straight to the workspace", async () => {
    await go(S.pk, `/w/${S.pkSlug}`);
    await S.pk.page.getByRole("button", { name: /sign out/i }).first().click();
    await S.pk.page.waitForURL(/\/login/, { timeout: 15000 });
    await signInAs(S.pk);
    await S.pk.page.waitForURL(new RegExp(`/w/${S.pkSlug}`), { timeout: 20000 });
  });
  await step("a wrong password and an unconfirmed address get the same plain message", async () => {
    const v = await persona("login-checks");
    await signInAs(v, S.pk.email, "wrong-password-here");
    await waitText(v, "do not match");
    const e = `unconfirmed.${tag}@example.com`;
    await go(v, "/signup");
    await fill(v, "#org_name", `Unconfirmed Co ${tag}`); await fill(v, "#contact_name", "No Confirm"); await fill(v, "#email", e);
    await fill(v, "#password", PW); await fill(v, "#confirm", PW);
    await v.page.check("input[name=terms]");
    await press(v, /start my/i, { wait: 1500 });
    check(v.page.url().includes("/signup/check-email"), `after sign-up: ${v.page.url()}`);
    await signInAs(v, e, PW);
    await waitText(v, "do not match");
    check(sql(`select count(*) from public.tenants where name = 'Unconfirmed Co ${tag}'`) === "0", "a workspace was built before the email was confirmed");
  });
  await step("signing up again with an address already in use says so, and builds nothing", async () => {
    const v = await persona("dupe");
    await go(v, "/signup");
    await fill(v, "#org_name", "Second Try Co"); await fill(v, "#contact_name", "Sana Malik"); await fill(v, "#email", S.pk.email);
    await fill(v, "#password", PW); await fill(v, "#confirm", PW);
    await v.page.check("input[name=terms]");
    await press(v, /start my/i, { wait: 1500 });
    check(v.page.url().endsWith("/signup"), `a customer's address went on to ${v.page.url()}`);
    check(has(await body(v), "already exists"), "the page did not say the account already exists");
    check(sql(`select count(*) from public.tenants where name = 'Second Try Co'`) === "0", "a second workspace was made");
  });
  await step("the confirmation email can be asked for again, with the same answer for any address", async () => {
    const v = await persona("resend");
    await go(v, "/signup/check-email");
    const email = v.page.locator("input[type=email]").first();
    await email.fill("someone@example.com");
    await press(v, /send/i, { wait: 900 });
    await waitText(v, "on its way");
  });

  await step("the sign-up form is Pakistan only (no country picker) and keeps the choices after a mistake (name, email)", async () => {
    const v = await persona("keeps");
    await go(v, "/signup");
    check((await v.page.locator("#country").count()) === 0, "a country picker is shown");
    check((await v.page.locator("input[name=country]").inputValue()) === "PK", "the country is not fixed to Pakistan");
    await fill(v, "#org_name", "Keeps Co"); await fill(v, "#contact_name", "Kay Keeper"); await fill(v, "#email", "keeps@example.com");
    await fill(v, "#password", PW); await fill(v, "#confirm", PW);               // terms left unticked on purpose
    await press(v, /start my/i, { wait: 1200 });
    await waitText(v, "Accept the terms");
    check((await v.page.inputValue("#org_name")) === "Keeps Co", "company name lost");
    check((await v.page.inputValue("#email")) === "keeps@example.com", "email lost");
  });
}
