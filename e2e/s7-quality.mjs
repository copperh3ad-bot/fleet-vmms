import { axe, body, check, finding, go, has, overflow, persona, scenario, shot, signInAs, step } from "./lib.mjs";

export async function quality(S) {
  scenario("7. Phones, accessibility and speed on the signed-in screens");
  const base = `/w/${S.pkSlug}`;
  const pages = ["", "/vehicles", "/job-cards", "/job-cards/new", "/policy", "/users", "/billing", "/employees", "/settings", "/reports", "/budgets", "/compliance"];

  const m = await persona("phone-owner", { viewport: { width: 375, height: 800 }, email: S.pk.email, password: S.pk.password });
  await signInAs(m);
  for (const width of [320, 375, 768, 1024, 1440]) {
    await m.page.setViewportSize({ width, height: 800 });
    for (const p of pages) {
      await step(`${base}${p || "/"} fits a ${width}px screen`, async () => {
        await go(m, `${base}${p}`);
        check(new URL(m.page.url()).pathname.startsWith(base), `went to ${m.page.url()}`);
        const o = await overflow(m);
        if (o > 1) {
          const wide = await m.page.evaluate((w) => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > w + 1 && !e.closest("table, .overflow-x-auto"))
            .slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(" ").slice(0, 4).join(".")} "${(e.textContent ?? "").trim().slice(0, 30)}"`), width);
          finding("mobile", `${p || "/"} is ${o}px wider than a ${width}px screen, so it scrolls sideways. Widest: ${wide.join(" | ")}`);
        }
        check(o <= 24, `${o}px wider than the screen`);
      });
    }
  }
  await m.page.setViewportSize({ width: 375, height: 800 });

  await step("every link on the signed-in screens and public pages answers", async () => {
    // Visits each page, collects the links on it, then asks for every distinct internal address once.
    const seen = new Map();   // address -> page it was found on
    const pagesToVisit = [...pages, "/odometer", "/vendors", "/accidents", "/challans", "/invoices", "/quotations", "/reports/breaking", "/notifications", "/vehicles/new", "/vehicles/import", "/job-cards/import", "/compliance/new", "/accidents/new"].map((p) => `${base}${p}`);
    pagesToVisit.push("/", "/pricing", "/about", "/contact", "/signup", "/login", "/join", "/join/workshop", "/terms", "/privacy", "/forgot-password");
    for (const p of pagesToVisit) {
      await go(S.pk, p);
      const hrefs = await S.pk.page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
      for (const h of hrefs) {
        if (!h || h.startsWith("#") || /^(mailto:|tel:|data:|blob:|javascript:|https?:\/\/(?!www\.fleetotg\.com))/.test(h) || h.startsWith("//")) continue;
        const resolved = new URL(h, new URL(S.pk.page.url()));   // a relative address is read from the page it is on
        const u = resolved.pathname + resolved.search;
        if (!seen.has(u)) seen.set(u, p);
      }
    }
    const bad = [];
    for (const [u, from] of seen) {
      if (/logout|signout/.test(u)) continue;
      const r = await S.pk.page.request.get(u, { maxRedirects: 5, failOnStatusCode: false });
      if (r.status() >= 400) bad.push(`${u} -> ${r.status()} (linked from ${from})`);
    }
    if (bad.length) finding("links", `Broken links: ${bad.join("; ")}`);
    check(bad.length === 0, `${bad.length} of ${seen.size} links broken: ${bad.slice(0, 5).join("; ")}`);
    return `${seen.size} distinct links checked`;
  });

  await step("phone menu folds away after a link in it is used", async () => {
    await go(m, `${base}`);
    const menu = m.page.locator("header details");
    await menu.locator("summary").click();
    check(await menu.evaluate((d) => d.open), "the menu did not open");
    await menu.locator('a[href$="/vehicles"]').first().click();
    await m.page.waitForURL(`**${base}/vehicles**`);
    check(!(await menu.evaluate((d) => d.open)), "the menu stayed open over the new page");
    await menu.locator("summary").click();
    await menu.locator(`a[aria-current="page"]`).first().click();   // the page you are already on
    check(!(await menu.evaluate((d) => d.open)), "the menu stayed open after a link to the same page");
  });

  await step("a signed-in person on a public page sees Open workspace, not Sign in and Start free trial", async () => {
    await go(S.pk, "/pricing");
    const open = S.pk.page.getByRole("link", { name: "Open workspace" }).first();
    await open.waitFor({ timeout: 5000 });
    check((await S.pk.page.getByRole("link", { name: "Start free trial" }).count()) === 0, "Start free trial is still shown to a signed-in person");
    check((await S.pk.page.locator("header").getByRole("link", { name: "Sign in" }).count()) === 0, "Sign in is still shown to a signed-in person");
    await open.click();
    await S.pk.page.waitForURL("**/w/**");
  });

  for (const p of ["", "/vehicles", "/policy", "/billing", "/users", "/job-cards/new"]) {
    await step(`${base}${p || "/"}: accessibility check`, async () => {
      await go(S.pk, `${base}${p}`);
      if (process.env.E2E_SHOTS) await shot(S.pk, `screen${p.replace(/\//g, "-") || "-home"}`);   // E2E_SHOTS=1 keeps a picture of each screen in e2e/shots
      const r = await axe(S.pk, `${p || "/"} (signed in)`);
      return `${r.length} issue types`;
    });
  }
  if (process.env.E2E_TEXT) {
    // E2E_TEXT=1 writes the words on every screen to e2e/shots/text-*.txt, so the wording can be read through in one sitting.
    await step("the words on every screen are saved for a wording check", async () => {
      const fs = await import("node:fs");
      for (const p of [...pages, "/odometer", "/vendors", "/accidents", "/challans", "/invoices", "/reports/breaking", "/notifications", "/vehicles/new", "/employees", "/maintenance-policy", "/policy"]) {
        await go(S.pk, `${base}${p}`);
        fs.writeFileSync(`e2e/shots/text-${(p || "home").replace(/\//g, "-").replace(/^-/, "")}.txt`, await body(S.pk));
      }
    });
  }
  await step("operator screens: accessibility check", async () => {
    for (const p of ["/admin", "/admin/payments", "/admin/tax", "/admin/accounting", "/admin/rates", "/admin/settings"]) { await go(S.op, p); await axe(S.op, `${p} (operator)`); }
  });

  await step("pages answer in a reasonable time (local server, real database)", async () => {
    const slow = [];
    for (const p of ["", "/vehicles", "/job-cards", "/policy", "/billing", "/users"]) {
      const t0 = Date.now(); await go(S.pk, `${base}${p}`); const ms = Date.now() - t0;
      if (ms > 2500) slow.push(`${p || "/"} ${ms}ms`);
    }
    if (slow.length) finding("speed", `Slow on a local server: ${slow.join(", ")}.`);
    return slow.length ? slow.join(", ") : "all under 2.5s";
  });
}
