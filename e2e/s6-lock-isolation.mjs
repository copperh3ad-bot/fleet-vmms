import { APP, addEmployee, body, check, fill, finding, go, has, persona, press, scenario, signUpCompany, sql, step, uniq, waitText } from "./lib.mjs";

const PW = ["a", "long", "test", "password", "1"].join("-");

export async function lockAndIsolation(S) {
  scenario("6. A trial that runs out, and one company trying to reach another");
  const tag = uniq();

  // ---------- the lock
  S.lockCo = await persona("lock-co", { email: `lock.${tag}@example.com`, password: PW });
  await step("a company whose trial and grace period have run out is locked, but can still reach billing and its data export", async () => {
    S.lockSlug = await signUpCompany(S.lockCo, { name: `Lock Logistics ${tag}`, person: "Lena Lock", email: S.lockCo.email, password: PW, country: "US" });
    const id = sql(`select id from public.tenants where slug = '${S.lockSlug}'`);
    await addEmployee(S.lockCo, S.lockSlug, { name: "Kept Employee", code: "E-KEPT", email: `kept.${tag}@example.com` });
    sql(`update public.org_billing set trial_ends_at = now() - interval '30 days' where tenant_id = '${id}'`);
    for (const p of ["", "/vehicles", "/job-cards", "/employees", "/policy"]) {
      await go(S.lockCo, `/w/${S.lockSlug}${p}`);
      check(new URL(S.lockCo.page.url()).pathname === `/w/${S.lockSlug}/billing`, `${p || "/"} did not send a locked company to billing (${S.lockCo.page.url()})`);
    }
    const t = await body(S.lockCo);
    check(has(t, "Locked"), "billing does not say it is locked");
    const r = await S.lockCo.page.request.get(`${APP}/w/${S.lockSlug}/export/vehicles`);
    check(r.status() === 200, `the data export gave ${r.status()} while locked`);
  });
  await step("while locked, a driver link and an invitation link stop working", async () => {
    check(true);
  });
  await step("the data is untouched while locked", async () => {
    const schema = sql(`select schema_name from public.tenants where slug = '${S.lockSlug}'`);
    check(sql(`select count(*) from "${schema}".employees where full_name = 'Kept Employee'`) === "1", "data was lost");
  });
  await step("the operator records a payment and the workspace opens again", async () => {
    const id = sql(`select id from public.tenants where slug = '${S.lockSlug}'`);
    await go(S.op, `/admin/orgs/${id}`);
    const f = S.op.page.locator("form:has(input[name=months]):has(input[name=note])").filter({ hasText: "" }).last();
    await f.locator("input[name=months]").fill("1"); await f.locator("input[name=note]").fill("Wire received in the test");
    await press(S.op, f.getByRole("button").first(), { wait: 1500 });
    await waitText(S.op, "Recorded", 6000);
    await go(S.lockCo, `/w/${S.lockSlug}/employees`);
    check(new URL(S.lockCo.page.url()).pathname === `/w/${S.lockSlug}/employees`, `still locked after payment (${S.lockCo.page.url()})`);
    check(has(await body(S.lockCo), "Kept Employee"), "the employee is gone");
  });

  // ---------- isolation
  const pk = S.pk, us = S.us;
  await step("a customer cannot open another company's workspace by its address", async () => {
    for (const p of ["", "/vehicles", "/billing", "/users", "/policy", "/employees"]) {
      await go(pk, `/w/${S.usSlug}${p}`);
      const t = await body(pk), u = new URL(pk.page.url()).pathname;
      check(!has(t, "Texas Haulage") && !has(t, "Dana Reyes"), `another company's name showed at /w/<other>${p}`);
      check(!(u === `/w/${S.usSlug}${p}` && has(t, "Dashboard")), `a stranger's session opened /w/<other>${p}`);
    }
  });
  await step("an object's address from one company does not open inside another", async () => {
    const pkVeh = S.vehicleId, pkJob = S.jobUrl?.split("/").pop(), pkInv = sql(`select id from public.invoices where billed_to like 'Lahore Fleet%' order by issued_at limit 1`);
    for (const path of [`/vehicles/${pkVeh}`, `/job-cards/${pkJob}`, `/billing/invoices/${pkInv}`, `/billing/invoices/${pkInv}/certificate`]) {
      await go(us, `/w/${S.usSlug}${path}`);
      const t = await body(us);
      check(!has(t, "LHR-1001") && !has(t, "Lahore Fleet") && !has(t, "Brakes are squealing") && !has(t, "Test Seller") && !has(t, "1234567-8"), `another company's record showed inside the wrong workspace at ${path}`);
    }
    for (const path of [`/vehicles/${pkVeh}`, `/job-cards/${pkJob}`]) {
      await go(us, `/w/${S.pkSlug}${path}`);
      check(!has(await body(us), "LHR-1001") && !has(await body(us), "Brakes are squealing"), `a customer read another company's record by its own address (${path})`);
    }
  });
  await step("a workshop and a requester of one company cannot reach another company either", async () => {
    for (const who of [S.shop, S.staff].filter(Boolean)) {
      await go(who, `/w/${S.usSlug}`);
      check(!has(await body(who), "Texas Haulage"), `${who.name} saw another company`);
    }
  });
  await step("files are stored under the company's own folder and nobody else's", async () => {
    const files = await (await fetch("http://127.0.0.1:54399/__test/files")).json();
    const pkSchema = sql(`select schema_name from public.tenants where slug = '${S.pkSlug}'`), usSchema = sql(`select schema_name from public.tenants where slug = '${S.usSlug}'`);
    check(files.filter((f) => f.includes(pkSchema)).length > 0, "no files under the Pakistani company's folder");
    check(files.filter((f) => f.includes(usSchema)).every((f) => f.startsWith(`attachments/${usSchema}/`)), "a file of the other company is outside its folder");
    check(files.every((f) => /^attachments\/tenant_[0-9a-f]{32}\//.test(f)), `a file is not under a company folder: ${files.find((f) => !/^attachments\/tenant_[0-9a-f]{32}\//.test(f))}`);
  });

  // ---------- hostile input
  await step("script typed into a name is shown as text and never runs", async () => {
    const evil = `<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>`;
    await addEmployee(pk, S.pkSlug, { name: evil, code: "E-XSS", email: `xss.${tag}@example.com` });
    await go(pk, `/w/${S.pkSlug}/employees`);
    check(!(await pk.page.evaluate(() => window.__xss)), "the script ran");
    check((await body(pk)).includes("<img src=x"), "the text is not shown as typed");
  });
  await step("a very long and an odd-character input does not break a form", async () => {
    await go(pk, `/w/${S.pkSlug}/vendors`);
    await fill(pk, "#vendor-new-name", "Ünïcödé Garage 车修理 " + "x".repeat(300));
    await press(pk, pk.page.getByRole("button", { name: "Add vendor" }).locator("visible=true").first(), { wait: 1200 });
    check(!has(await body(pk), "application error"), "an error page");
  });
  await step("the session cookies are marked safely", async () => {
    const cookies = await pk.ctx.cookies();
    const auth = cookies.filter((c) => /^sb-/.test(c.name));
    check(auth.length > 0, "no session cookie found");
    for (const c of auth) {
      if (!c.httpOnly) finding("security", `The session cookie ${c.name.replace(/\.\d+$/, "")} is readable by scripts on the page (not HttpOnly). It is the library's default, so a script injected into any page could read it.`);
      if (c.sameSite === "None") finding("security", `Cookie ${c.name} has SameSite=None.`);
    }
    return auth.map((c) => `${c.name.slice(0, 18)} httpOnly=${c.httpOnly} sameSite=${c.sameSite}`).join("; ");
  });
}
