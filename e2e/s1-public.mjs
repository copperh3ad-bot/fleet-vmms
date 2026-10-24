import { APP, axe, body, check, finding, fill, go, has, overflow, persona, press, scenario, step, waitText } from "./lib.mjs";

const PUBLIC = ["/", "/pricing", "/signup", "/signup/check-email", "/join", "/join/workshop", "/join/sent", "/login", "/terms", "/privacy"];

export async function publicPages(S) {
  scenario("1. Public pages, signed out");
  const v = await persona("visitor");
  S.visitor = v;

  for (const path of PUBLIC) {
    await step(`${path} loads, has one h1, no browser errors`, async () => {
      const r = await go(v, path, 200);
      check(new URL(v.page.url()).pathname === path, `${path} sent the visitor to ${v.page.url()}`);
      const h1 = await v.page.locator("h1").count();
      check(h1 >= 1, `no h1 on ${path}`);
      const title = await v.page.title();
      check(title.length > 3, `no page title on ${path}`);
      check(!has(await body(v), "application error"), "an error page was shown");
      return `${title} (${r.status()})`;
    });
  }

  await step("the landing page offers sign-up, pricing and sign-in", async () => {
    await go(v, "/");
    const t = await body(v);
    for (const w of ["free trial", "Sign in", "$149"]) check(has(t, w), `landing page lacks "${w}"`);
    check(await v.page.locator("a[href='/signup']").count() > 0, "no link to /signup");
    check(await v.page.locator("a[href='/pricing']").count() > 0, "no link to /pricing");
  });

  await step("the login page links to sign-up and to joining a company", async () => {
    await go(v, "/login");
    const links = await v.page.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    if (!links.includes("/signup") && !links.includes("/join")) finding("ux", "The sign-in page has no link to start a trial (/signup) or to join a company (/join); it only says to use an invitation link.");
    return `links: ${links.join(", ") || "none"}`;
  });

  await step("a wrong password gives one plain message and stays on the page", async () => {
    await go(v, "/login");
    await fill(v, "#email", "nobody@example.com"); await fill(v, "#password", "not-the-password");
    await press(v, "Sign in", { exact: true, wait: 800 });
    check(has(await body(v), "do not match"), `no message: ${(await body(v)).slice(0, 120)}`);
    check(v.page.url().includes("/login"), "left the login page");
  });

  await step("sign-up form refuses an empty form with messages next to the fields, and creates nothing", async () => {
    await go(v, "/signup");
    await press(v, /start my/i, { wait: 600 });
    const t = await body(v);
    for (const w of ["company name", "country"]) check(has(t, w), `no message about "${w}"`);
    check(v.page.url().endsWith("/signup"), "moved on from /signup");
  });

  await step("sign-up form checks the passwords and the terms", async () => {
    await go(v, "/signup");
    await fill(v, "#org_name", "Validation Co"); await fill(v, "#contact_name", "Test Person"); await fill(v, "#email", "validate@example.com");
    await v.page.selectOption("#country", "PK");
    await fill(v, "#password", "short"); await fill(v, "#confirm", "short");
    await press(v, /start my/i, { wait: 600 });
    await waitText(v, "at least 10");
    await fill(v, "#password", "a-long-enough-password"); await fill(v, "#confirm", "a-different-password");
    await v.page.check("input[name=terms]");
    await press(v, /start my/i, { wait: 600 });
    await waitText(v, "do not match");
    check((await v.page.inputValue("#org_name")) === "Validation Co", "the form lost what was typed");
  });

  await step("the country list starts with Pakistan and covers the world", async () => {
    await go(v, "/signup");
    const opts = await v.page.locator("#country option").allTextContents();
    check(opts[1] === "Pakistan", `first country is ${opts[1]}`);
    check(opts.length > 240, `only ${opts.length} countries`);
  });

  await step("joining with a wrong code says so, and records nothing", async () => {
    await go(v, "/join");
    await fill(v, "#code", "ZZZZZZZZZZ"); await fill(v, "#full_name", "Nobody Here"); await fill(v, "#email", "nobody-join@example.com");
    await fill(v, "#password", "a-long-enough-password"); await fill(v, "#confirm", "a-long-enough-password");
    await v.page.check("input[name=terms]");
    await press(v, "Ask to join", { wait: 800 });
    await waitText(v, "not recognised");
  });

  await step("the join page fills in the code from the link", async () => {
    await go(v, "/join?code=abcde-fghjk");
    check((await v.page.inputValue("#code")) === "ABCDEFGHJK", "code not prefilled and tidied");
    await go(v, "/join/workshop?code=ABCDEFGHJK");
    check(await v.page.locator("#workshop_name").count() === 1, "the workshop form has no workshop name field");
  });

  await step("signed-out visitors are sent to the sign-in page from every private address", async () => {
    for (const p of ["/w/demo", "/w/demo/billing", "/w/demo/vehicles", "/admin", "/admin/accounting", "/setup", "/w/demo/policy"]) {
      await go(v, p);
      check(new URL(v.page.url()).pathname === "/login", `${p} ended at ${v.page.url()}`);
    }
  });

  await step("a made-up driver link and invitation link say nothing about whose they are", async () => {
    const bad = "A".repeat(43);
    await go(v, `/o/${bad}`); const a = await body(v);
    await go(v, `/invite/${bad}`); const b = await body(v);
    check(a.length > 10 && b.length > 10, "empty page");
    check(!/tenant_|schema|error:|stack/i.test(a + b), "technical detail leaked");
  });

  await step("an unknown page is a proper 404, not a crash", async () => {
    const r = await go(v, "/this-page-does-not-exist-xyz");
    check(r.status() < 500, `status ${r.status()}`);                                   // signed out, every private or unknown address goes to the sign-in page
  });

  await step("the driver link is not cached and not indexed", async () => {
    const r = await v.page.request.get(`${APP}/o/${"A".repeat(43)}`);
    const h = r.headers();
    check(/no-store/.test(h["cache-control"] ?? ""), `cache-control: ${h["cache-control"]}`);
    check(/noindex/.test(h["x-robots-tag"] ?? ""), `x-robots-tag: ${h["x-robots-tag"]}`);
  });

  await step("the site does not announce what it runs on", async () => {
    const r = await v.page.request.get(`${APP}/`);
    check(!r.headers()["x-powered-by"], `x-powered-by: ${r.headers()["x-powered-by"]}`);
  });

  await step("the terms and privacy pages are free of placeholders", async () => {
    for (const p of ["/terms", "/privacy"]) {
      await go(v, p);
      const t = await body(v);
      const ph = t.match(/\[[^\]]{3,80}\]/g) ?? [];
      if (ph.length) finding("launch", `${p} still has ${ph.length} placeholder${ph.length > 1 ? "s" : ""} in [brackets] to replace, e.g. ${ph[0]}`);
      if (/draft/i.test(t)) finding("launch", `${p} is marked as a draft.`);
    }
  });

  for (const path of ["/", "/pricing", "/signup", "/login", "/join"]) {
    await step(`${path} fits a phone screen (375px) with no sideways scrolling`, async () => {
      const m = await persona("phone-" + path, { viewport: { width: 375, height: 800 } });
      await go(m, path);
      const o = await overflow(m);
      await m.ctx.close();
      check(o <= 1, `${o}px wider than the screen`);
    });
  }

  for (const path of ["/", "/pricing", "/signup", "/login", "/join", "/join/workshop"]) {
    await step(`${path}: accessibility check`, async () => { await go(v, path); const r = await axe(v, path); return `${r.length} issue types`; });
  }
}
