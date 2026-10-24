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
  page.on("response", (r) => { if (r.status() >= 500) bag.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url().slice(0, 120)}`); });
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
  await p.page.selectOption("#country", country);
  await fill(p, "#password", password); await fill(p, "#confirm", password);
  await p.page.check("input[name=terms]");
  await press(p, /start my/i, { wait: 1000 });
  check(p.page.url().includes("/signup/check-email"), `after sign-up the page was ${p.page.url()}`);
  const { code } = await confirmEmail(email);
  await go(p, `/auth/callback?code=${code}`);
  await p.page.waitForURL(/\/w\/[a-z0-9-]+/, { timeout: 90000 });
  return new URL(p.page.url()).pathname.split("/")[2];
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
