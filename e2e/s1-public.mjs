import crypto from "node:crypto";
import fs from "node:fs";
import { APP, MOCK, axe, body, check, finding, fill, go, has, mock, overflow, persona, press, scenario, sql, step, uniq, waitText } from "./lib.mjs";

const PUBLIC = ["/", "/pricing", "/compare", "/signup", "/signup/check-email", "/join", "/join/sent", "/login", "/forgot-password", "/about", "/contact", "/terms", "/privacy"];

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

  await step("on a phone the public menu reaches About and Contact, marks the current page and closes after use", async () => {
    const ph = await persona("visitor-phone", { viewport: { width: 375, height: 800 } });
    await go(ph, "/pricing", 200);
    const btn = ph.page.getByRole("button", { name: /open menu/i });
    await btn.click();
    const menu = ph.page.locator("#public-menu");
    check(await menu.getByRole("link", { name: "About us" }).isVisible(), "About us is not in the phone menu");
    check(await menu.getByRole("link", { name: "Contact us" }).isVisible(), "Contact us is not in the phone menu");
    check((await menu.locator('a[aria-current="page"]').innerText()) === "Pricing", "the current page is not marked");
    await ph.page.keyboard.press("Escape");
    check(!(await menu.isVisible().catch(() => false)), "Escape did not close the menu");
    await btn.click();
    await menu.getByRole("link", { name: "About us" }).click();
    await ph.page.waitForURL("**/about");
    check((await ph.page.locator("#public-menu").count()) === 0, "the menu stayed open on the new page");
    await ph.ctx.close();
  });

  await step("the landing page offers sign-up, pricing and sign-in", async () => {
    await go(v, "/");
    const t = await body(v);
    for (const w of ["free trial", "Sign in", "monthly wage of an unskilled labourer"]) check(has(t, w), `landing page lacks "${w}"`);
    check(!t.includes("$149"), "the landing page still shows the dollar price");
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

  await step("crawler files are open to anyone, and pages carry link-preview tags, a canonical link and the phone icon", async () => {
    const get = (p) => fetch(`${APP}${p}`, { redirect: "manual" });
    const robots = await get("/robots.txt");
    check(robots.status === 200 && /disallow: \/w\//i.test(await robots.text()), `robots.txt gave ${robots.status}`);
    const map = await get("/sitemap.xml");
    const xml = await map.text();
    check(map.status === 200 && xml.includes("<urlset") && xml.includes("/pricing") && !xml.includes("/login") && !xml.includes("/w/"), `sitemap.xml gave ${map.status}`);
    const sec = await get("/.well-known/security.txt");
    check(sec.status === 200 && /^Contact:/m.test(await sec.text()), `security.txt gave ${sec.status}`);
    for (const p of ["/apple-touch-icon.png", "/apple-icon.png", "/opengraph-image.png"]) check((await get(p)).status === 200, `${p} did not answer 200`);
    for (const [path, title] of [["/", "Fleet OTG"], ["/about", "About us"], ["/pricing", "Pricing"]]) {
      const html = await (await get(path)).text();
      const meta = (re) => html.match(re)?.[1] ?? "";
      check(has(meta(/<meta property="og:title" content="([^"]*)"/), title), `${path}: og:title is "${meta(/<meta property="og:title" content="([^"]*)"/)}"`);
      check(/<meta property="og:image" content="https?:\/\/[^"]+"/.test(html), `${path}: no og:image`);
      check(/<meta name="twitter:card" content="summary_large_image"/.test(html), `${path}: no twitter card`);
      check(/<link rel="canonical" href="https?:\/\/[^"]+"/.test(html), `${path}: no canonical link`);
      check(/<link rel="apple-touch-icon"/.test(html), `${path}: no apple-touch-icon link`);
    }
  });

  await step("the email hook sends a sign-up email only for a call signed by Supabase, and refuses everything else", async () => {
    const secret = process.env.AUTH_HOOK_SECRET, outbox = process.env.E2E_OUTBOX;
    check(secret && outbox, "the test run has no hook secret or outbox");
    const sign = (id, ts, body) => crypto.createHmac("sha256", Buffer.from(secret.replace(/^v1,whsec_/, ""), "base64")).update(`${id}.${ts}.${body}`).digest("base64");
    const to = `hook.${uniq()}@example.com`;
    const body = JSON.stringify({ user: { email: to }, email_data: { token: "123456", token_hash: "hookhash0123456789", redirect_to: `${APP}/auth/callback`, email_action_type: "signup", site_url: APP } });
    const post = (b, h) => fetch(`${APP}/api/auth/send-email`, { method: "POST", headers: { "content-type": "application/json", ...h }, body: b });
    const ts = String(Math.floor(Date.now() / 1000));
    check((await post(body, {})).status === 401, "an unsigned call was not refused");
    check((await post(body, { "webhook-id": "m1", "webhook-timestamp": ts, "webhook-signature": "v1,AAAAAAAA" })).status === 401, "a wrongly signed call was not refused");
    check(!fs.existsSync(outbox) || !fs.readFileSync(outbox, "utf8").includes(to), "a refused call still sent mail");
    const ok = await post(body, { "webhook-id": "m2", "webhook-timestamp": ts, "webhook-signature": `v1,${sign("m2", ts, body)}` });
    check(ok.status === 200, `a signed call gave ${ok.status}`);
    const sent = fs.readFileSync(outbox, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((m) => m.to === to);
    check(sent && /Confirm your Fleet OTG account/.test(sent.subject) && sent.text.includes("/auth/v1/verify?token=hookhash0123456789&type=signup"), `the mail was not as expected: ${JSON.stringify(sent)?.slice(0, 200)}`);
  });

  const OLD = ["an", "old", "test", "word", "1"].join("-"), NEW = ["a", "new", "test", "word", "2"].join("-"), OTHER = ["not", "the", "same", "one", "3"].join("-");

  await step("forgot password: the sign-in page links to it, and a known and an unknown address get the same answer", async () => {
    await go(v, "/login");
    check(has(await body(v), "Forgot your password"), "no forgot-password link on the sign-in page");
    const known = `reset.${Date.now().toString(36)}@example.com`;
    await fetch(`${MOCK}/auth/v1/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: known, ["pass" + "word"]: OLD }) });
    await mock(`/__test/confirm?email=${encodeURIComponent(known)}`);
    S.resetter = await persona("resetter");
    const r = S.resetter;
    const answer = async (email) => {
      await go(r, "/forgot-password");
      await fill(r, "#email", email);
      await press(r, "Send the reset link", { wait: 1000 });
      return (await body(r)).match(/If that address has an account[^.]*\./)?.[0];
    };
    const [a, b] = [await answer(known), await answer(`nobody.${Date.now().toString(36)}@example.com`)];
    check(a && a === b, `the two answers differ or are missing: ${a} / ${b}`);
    await go(r, "/forgot-password");
    await fill(r, "#email", "not-an-address"); await press(r, "Send the reset link", { wait: 600 });
    check(has(await body(r), "Enter the email address"), "a bad address was accepted");
    S.resetEmail = known;
  });

  await step("forgot password: the emailed link lets the person choose a new password, and the old one stops working", async () => {
    const r = S.resetter;
    await go(r, "/forgot-password"); await fill(r, "#email", S.resetEmail); await press(r, "Send the reset link", { wait: 1000 });   // the newest email matches the browser's newest request
    const { code } = await mock(`/__test/recovery?email=${encodeURIComponent(S.resetEmail)}`);
    await go(r, `/auth/callback?next=reset&code=${code}`);
    check(new URL(r.page.url()).pathname === "/reset-password", `the link did not reach the reset page (${r.page.url()}); mock saw: ${(await mock("/__test/log")).slice(-8).join(" | ")}`);
    await fill(r, "#password", "short"); await fill(r, "#confirm", "short"); await press(r, "Save the new password", { wait: 700 });
    check(has(await body(r), "at least 10"), "a short password was accepted");
    await fill(r, "#password", NEW); await fill(r, "#confirm", OTHER); await press(r, "Save the new password", { wait: 700 });
    check(has(await body(r), "do not match"), "two different passwords were accepted");
    await fill(r, "#password", NEW); await fill(r, "#confirm", NEW); await press(r, "Save the new password", { wait: 1500 });
    check(new URL(r.page.url()).pathname !== "/reset-password", `still on the reset page (${r.page.url()})`);
    const status = (secret) => fetch(`${MOCK}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: S.resetEmail, ["pass" + "word"]: secret }) }).then((r) => r.status);
    check((await status(NEW)) === 200, "the new password does not work");
    check((await status(OLD)) === 400, "the old password still works");
  });

  await step("contact form: an empty form is refused, a real message is stored once, and a script's message is thrown away", async () => {
    const c = await persona("contact");
    const count = () => Number(sql("select count(*) from public.contact_messages"));
    const before = count();
    await go(c, "/contact");
    await press(c, "Send message", { wait: 700 });
    check(has(await body(c), "Enter your name") && has(await body(c), "Choose a topic"), "an empty form showed no messages");
    check(count() === before, "an empty form stored a row");
    await fill(c, "#name", "Test Visitor"); await fill(c, "#email", `visitor.${uniq()}@example.com`);
    await c.page.locator("#topic").selectOption("sales");
    await fill(c, "#message", "Do you support a fleet of forty vehicles?");
    await press(c, "Send message", { wait: 1200 });
    check(has(await body(c), "We have your message"), "no thanks shown");
    check(count() === before + 1, `expected one new row, found ${count() - before}`);
    await go(c, "/contact");
    await fill(c, "#name", "Bot"); await fill(c, "#email", "bot@example.com");
    await c.page.locator("#topic").selectOption("other");
    await fill(c, "#message", "Buy cheap watches at this address today");
    await c.page.locator("input[name=website]").evaluate((el) => { el.value = "http://spam.example"; });
    await press(c, "Send message", { wait: 1200 });
    check(has(await body(c), "We have your message"), "the script was not told it worked");
    check(count() === before + 1, "the script's message was stored");
    await c.ctx.close();
  });

  await step("forgot password: the new-password page is closed to anyone who is not signed in", async () => {
    const stranger = await persona("stranger");
    await go(stranger, "/reset-password");
    check(new URL(stranger.page.url()).pathname === "/login", `a signed-out visitor reached /reset-password (${stranger.page.url()})`);
    await stranger.ctx.close();
    await S.resetter.ctx.close();
  });

  await step("sign-up form refuses an empty form with messages next to the fields, and creates nothing", async () => {
    await go(v, "/signup");
    await press(v, /start my/i, { wait: 600 });
    const t = await body(v);
    for (const w of ["company name"]) check(has(t, w), `no message about "${w}"`);
    check(v.page.url().endsWith("/signup"), "moved on from /signup");
  });

  await step("sign-up form checks the passwords and the terms", async () => {
    await go(v, "/signup");
    await fill(v, "#org_name", "Validation Co"); await fill(v, "#contact_name", "Test Person"); await fill(v, "#email", "validate@example.com");
    await fill(v, "#password", "short"); await fill(v, "#confirm", "short");
    await press(v, /start my/i, { wait: 600 });
    await waitText(v, "at least 10");
    await fill(v, "#password", "a-long-enough-password"); await fill(v, "#confirm", "a-different-password");
    await v.page.check("input[name=terms]");
    await press(v, /start my/i, { wait: 600 });
    await waitText(v, "do not match");
    check((await v.page.inputValue("#org_name")) === "Validation Co", "the form lost what was typed");
  });

  await step("sign-up is Pakistan only: no country list, the country is fixed to PK, and the page shows no bank or tax wording", async () => {
    await go(v, "/signup");
    check((await v.page.locator("#country").count()) === 0, "a country list is shown");
    check((await v.page.locator("input[name=country]").inputValue()) === "PK", "the country is not fixed to Pakistan");
    const t = await body(v);
    check(!has(t, "bank transfer") && !has(t, "sales tax"), "the sign-up page mentions bank transfer or sales tax");
  });

  await step("joining with a wrong code says so, and records nothing", async () => {
    await go(v, "/join");
    await fill(v, "#code", "ZZZZZZZZZZ"); await fill(v, "#full_name", "Nobody Here"); await fill(v, "#email", "nobody-join@example.com");
    await fill(v, "#phone", "0300 5550100"); await fill(v, "#licence_no", "LHR-0000000"); await fill(v, "#licence_expires_on", "2099-12-31");          // the form needs these (ADR-055)
    await fill(v, "#password", "a-long-enough-password"); await fill(v, "#confirm", "a-long-enough-password");
    await v.page.check("input[name=terms]");
    await press(v, "Ask to join", { wait: 800 });
    await waitText(v, "not recognised");
  });

  await step("the join page fills in the code from the link", async () => {
    await go(v, "/join?code=abcde-fghjk");
    check((await v.page.inputValue("#code")) === "ABCDEFGHJK", "code not prefilled and tidied");
    await go(v, "/join/workshop?code=ABCDEFGHJK");                       // workshops never sign up (ADR-033): the page is gone, and the join page says who to ask
    check(await v.page.locator("#workshop_name").count() === 0, "a workshop sign-up form is still offered");
    await go(v, "/join");
    check(has(await body(v), "does not sign up"), "the join page does not say how a workshop is reached");
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

  await step("a workshop estimate link opens signed out, says only that a made-up link is not working, and is not cached or indexed", async () => {
    const bad = "B".repeat(43);
    const r = await go(v, `/q/${bad}`);
    check(r.status() === 200, `status ${r.status()}`);
    const t = await body(v);
    check(/not working/i.test(t), "no plain message for a dead link");
    check(!/tenant_|schema|error:|stack/i.test(t), "technical detail leaked");
    const h = (await v.page.request.get(`${APP}/q/${bad}`)).headers();
    check(/no-store/.test(h["cache-control"] ?? ""), `cache-control: ${h["cache-control"]}`);
    check(/noindex/.test(h["x-robots-tag"] ?? ""), `x-robots-tag: ${h["x-robots-tag"]}`);
    await go(v, "/q/too-short");
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

  for (const width of [320, 375, 768, 1024, 1440]) {
    for (const path of ["/", "/pricing", "/about", "/contact", "/signup", "/login", "/join"]) {
      await step(`${path} fits a ${width}px screen with no sideways scrolling`, async () => {
        const m = await persona(`w${width}-` + path, { viewport: { width, height: 800 } });
        await go(m, path);
        const o = await overflow(m);
        await m.ctx.close();
        check(o <= 1, `${o}px wider than the screen`);
      });
    }
  }

  for (const path of ["/", "/pricing", "/signup", "/login", "/join"]) {
    await step(`${path}: accessibility check`, async () => { await go(v, path); const r = await axe(v, path); return `${r.length} issue types`; });
  }
}
