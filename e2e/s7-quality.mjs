import { axe, body, check, finding, go, has, overflow, persona, scenario, signInAs, step } from "./lib.mjs";

export async function quality(S) {
  scenario("7. Phones, accessibility and speed on the signed-in screens");
  const base = `/w/${S.pkSlug}`;
  const pages = ["", "/vehicles", "/job-cards", "/job-cards/new", "/policy", "/users", "/billing", "/employees", "/settings", "/reports", "/budgets", "/compliance"];

  const m = await persona("phone-owner", { viewport: { width: 375, height: 800 }, email: S.pk.email, password: S.pk.password });
  await signInAs(m);
  for (const p of pages) {
    await step(`${base}${p || "/"} fits a phone screen`, async () => {
      await go(m, `${base}${p}`);
      check(new URL(m.page.url()).pathname.startsWith(base), `went to ${m.page.url()}`);
      const o = await overflow(m);
      if (o > 1) finding("mobile", `${p || "/"} is ${o}px wider than a 375px phone screen, so it scrolls sideways.`);
      check(o <= 24, `${o}px wider than the screen`);
    });
  }

  for (const p of ["", "/vehicles", "/policy", "/billing", "/users", "/job-cards/new"]) {
    await step(`${base}${p || "/"}: accessibility check`, async () => {
      await go(S.pk, `${base}${p}`);
      const r = await axe(S.pk, `${p || "/"} (signed in)`);
      return `${r.length} issue types`;
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
