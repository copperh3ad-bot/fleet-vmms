// Helpers for the browser beta test: a tiny test recorder, browser personas, and calls to the stand-in login service and the database.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
export const APP = process.env.APP ?? "http://127.0.0.1:3100";
export const MOCK = process.env.MOCK ?? "http://127.0.0.1:54399";
export const DB = process.env.E2E_DB ?? "fleet_vmms_e2e";
export const PGHOST = process.env.E2E_PGHOST ?? "/tmp";                // where the local Postgres socket is
export const SHOTS = path.join(path.dirname(new URL(import.meta.url).pathname), "shots");
export const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
fs.mkdirSync(SHOTS, { recursive: true });
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

export const results = [];            // { scenario, step, ok, ms, note }
export const findings = [];           // things worth fixing, even when a step passed
export const issues = new Map();      // page problems seen while browsing: console errors, failed requests, 5xx
let current = "setup";
export const scenario = (name) => { current = name; console.log(`\n== ${name}`); };
export const finding = (severity, text) => { findings.push({ scenario: current, severity, text }); console.log(`   ! [${severity}] ${text}`); };

export async function step(name, fn) {
  const t0 = Date.now();
  try { const note = await fn(); results.push({ scenario: current, step: name, ok: true, ms: Date.now() - t0, note: note ?? "" }); console.log(`   ok   ${name}`); }
  catch (e) {
    const msg = String(e?.message ?? e).split("\n")[0].slice(0, 300);
    results.push({ scenario: current, step: name, ok: false, ms: Date.now() - t0, note: msg });
    console.log(`   FAIL ${name}\n        ${msg}`);
    return false;
  }
  return true;
}
export function check(cond, msg) { if (!cond) throw new Error(msg); }
export const has = (text, needle) => String(text).toLowerCase().includes(String(needle).toLowerCase());

// ---------- browser
let browser;
export async function launch() {
  // PLAYWRIGHT_CHROMIUM points at a Chrome or Chromium to use; without it, the browser playwright-core expects (npx playwright-core install chromium).
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
  return browser;
}
export const close = () => browser?.close();

/** A separate person: own cookies, own page, and a record of everything that went wrong in it. */
export async function persona(name, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 900 }, acceptDownloads: true, baseURL: APP });
  const page = await ctx.newPage();
  const bag = [];
  issues.set(name, bag);
  page.on("console", (m) => { if (m.type() === "error") bag.push(`console: ${m.text().slice(0, 200)} @ ${new URL(page.url() || APP).pathname}`); });
  page.on("pageerror", (e) => bag.push(`pageerror: ${String(e.message).slice(0, 200)} @ ${new URL(page.url() || APP).pathname}`));
  page.on("requestfailed", (r) => { if (!/_rsc=|\/_next\/static|favicon/.test(r.url()) && r.failure()?.errorText !== "net::ERR_ABORTED") bag.push(`request failed: ${r.method()} ${r.url().slice(0, 120)} ${r.failure()?.errorText}`); });
  page.on("response", (r) => { if (r.status() >= 500 || (r.status() === 404 && r.request().resourceType() !== "document")) bag.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url().slice(0, 120)}`); });   // a missing file or script is worth knowing; a page that is meant to be 404 is not
  return { name, ctx, page, email: opts.email, password: opts.password };
}

export async function shot(p, label) { const f = path.join(SHOTS, `${label.replace(/[^a-z0-9]+/gi, "-")}.png`); await p.page.screenshot({ path: f, fullPage: true }).catch(() => undefined); return f; }
export const body = (p) => p.page.locator("body").innerText();
export async function go(p, url, expectStatus) {
  const r = await p.page.goto(url, { waitUntil: "load" });
  await p.page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => undefined);      // pages stream their content in after the load event
  if (expectStatus) check(r?.status() === expectStatus, `GET ${url} gave ${r?.status()}, wanted ${expectStatus}`);
  return r;
}
/** Clicks a button and waits for the server to answer (actions are POSTs followed by a refresh). */
export async function press(p, nameOrLocator, opts = {}) {
  const loc = typeof nameOrLocator === "string" || nameOrLocator instanceof RegExp ? p.page.getByRole("button", { name: nameOrLocator, exact: opts.exact ?? false }).first() : nameOrLocator;
  await loc.click();
  await p.page.waitForLoadState("networkidle").catch(() => undefined);
  await p.page.waitForTimeout(opts.wait ?? 400);
}
export async function fill(p, selector, value) { await p.page.locator(selector).first().fill(String(value)); }

// ---------- axe
export async function axe(p, label, { include = null } = {}) {
  await p.page.evaluate(AXE);
  const r = await p.page.evaluate(async (inc) => (await window.axe.run(inc ? { include: [[inc]] } : document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] })).violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, sample: v.nodes[0]?.target?.join(" ") })), include);
  const serious = r.filter((v) => v.impact === "serious" || v.impact === "critical");
  for (const v of serious) finding("a11y", `${label}: ${v.id} (${v.impact}, ${v.n}x) ${v.help} e.g. ${String(v.sample).slice(0, 80)}`);
  for (const v of r.filter((x) => x.impact === "moderate")) finding("a11y-minor", `${label}: ${v.id} (${v.n}x) ${v.help}`);
  return r;
}
export async function overflow(p) { return p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); }

// ---------- stand-in login service and the database
export const mock = async (p, init) => (await fetch(`${MOCK}${p}`, init)).json();
export const confirmEmail = (email) => mock(`/__test/confirm?email=${encodeURIComponent(email)}`);
export const userId = async (email) => (await mock(`/__test/user?email=${encodeURIComponent(email)}`)).id;
/** A made-up Pakistani mobile number that is the same for the same seed and different for different ones (the join form limits how many messages one number may get). */
export function phoneFor(seed) {
  let h = 7; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) % 1_000_000_000;
  return `03${String(h).padStart(9, "0")}`;
}

/** Types the 6-digit code the app "sent on WhatsApp" (read from the test outbox) on the page the person is on after asking to join, as they would from their phone (ADR-055). */
export async function confirmJoinOnWhatsApp(p) {
  const lines = fs.readFileSync(process.env.E2E_WHATSAPP, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const last = [...lines].reverse().find((m) => /code \d{6} to join/.test(m.body ?? ""));
  check(last, "no WhatsApp code was sent");
  const code = (last.body.match(/code (\d{6}) to join/) ?? [])[1];
  await p.page.getByRole("heading", { name: /type the code from WhatsApp/i }).waitFor({ timeout: 10000 });
  await p.page.locator("#join-code").fill(code);
  await p.page.getByRole("button", { name: "Confirm", exact: true }).click();
  await p.page.getByText(/you are confirmed/i).waitFor({ timeout: 10000 });
}

export function sql(q) { return execFileSync("psql", ["-h", PGHOST, "-d", DB, "-At", "-F", "|", "-c", q], { encoding: "utf8" }).trim(); }
export const fixture = (n) => path.join(REPO, "tests/fixtures", n);
export const uniq = () => Math.random().toString(36).slice(2, 7);

// ---------- flows used by several scenarios
export async function signInAs(p, email = p.email, password = p.password) {
  await go(p, "/login");
  await fill(p, "#email", email); await fill(p, "#password", password);
  await press(p, "Sign in", { exact: true, wait: 800 });
}

/** Fills the company sign-up form, confirms the email through the stand-in, and waits for the workspace to be built. Returns the slug. */
export async function signUpCompany(p, { name, person, email, password, country }) {
  await go(p, "/signup");
  await fill(p, "#org_name", name); await fill(p, "#contact_name", person); await fill(p, "#email", email);
  if (await p.page.locator("#country").count()) await p.page.selectOption("#country", country);   // Pakistan only: no picker, the form sends PK
  await fill(p, "#password", password); await fill(p, "#confirm", password);
  await p.page.check("input[name=terms]");
  await press(p, /start my/i, { wait: 1000 });
  check(p.page.url().includes("/signup/check-email"), `after sign-up the page was ${p.page.url()}`);
  const { code } = await confirmEmail(email);
  await go(p, `/auth/callback?code=${code}`);
  await p.page.waitForURL(/\/w\/[a-z0-9-]+/, { timeout: 90000 });
  const slug = new URL(p.page.url()).pathname.split("/")[2];
  // the hidden foreign-customer flows are still in the code: a test customer abroad gets its country set directly
  if (country && country !== "PK") sql(`update public.org_tax set country = '${country}' where tenant_id = (select id from public.tenants where slug = '${slug}')`);
  return slug;
}

/** Adds an employee the only way there is (ADR-041): the invite form on the Users page, every box filled in. Leaves the person on that page with the link box showing. */
export async function addEmployee(p, slug, { name, code, email, department = "Operations", phone = `03${Math.floor(1e8 + Math.random() * 9e8)}`, role = "requester" }) {   // a number belongs to one organization at a time (ADR-082), so each call gets its own

  await go(p, `/w/${slug}/users`);
  const f = p.page.locator("form:has(#employee_no)").first();
  await f.locator("#employee_no").fill(code); await f.locator("#full_name").fill(name); await f.locator("#department").fill(department);
  await f.locator("#role").selectOption(role); await f.locator("#phone").fill(phone); await f.locator("#email").fill(email);
  await f.locator("#licence_no").fill(`LIC-${code}`); await f.locator("#licence_expires_on").fill(new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10));          // a valid driving licence is needed (ADR-054)
  await press(p, "Add and invite", { wait: 1500 });
  check(has(await body(p), "Employee added and invited"), `the employee was not added: ${(await p.page.locator("[role=alert], [role=status]").allInnerTexts()).join(" | ")}`);
  // the link is also emailed (ADR-041): the screen says so, and the test outbox holds the message with a one-time link
  check(has(await body(p), "We also emailed the link"), "the screen does not say the link was emailed");
  const sent = fs.readFileSync(process.env.E2E_OUTBOX, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((m) => m.to === email.toLowerCase() && /has invited you to Fleet OTG/.test(m.subject));
  check(sent.length > 0, "no invitation email was sent");
  check(/\/invite\/[A-Za-z0-9_-]{43}/.test(sent[sent.length - 1].text), "the invitation email has no one-time link");
}

/** Waits (up to a few seconds) for some text to show on the page: server actions answer a moment after the click. */
export async function waitText(p, text, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (has(await body(p), text)) return true; await p.page.waitForTimeout(250); }
  throw new Error(`"${text}" never appeared. The page said: ${(await body(p)).replace(/\s+/g, " ").slice(0, 160)}`);
}

/** Waits until a query returns the wanted value: the page's own words are not proof that a server action finished. */
export async function waitSql(query, want, ms = 10000) {
  const t0 = Date.now(); let got;
  while (Date.now() - t0 < ms) { got = sql(query); if (got === want) return got; await new Promise((r) => setTimeout(r, 300)); }
  throw new Error(`expected ${JSON.stringify(want)}, the database says ${JSON.stringify(got)}`);
}
