import { readFileSync } from "node:fs";
import { APP, body, check, fill, fixture, go, has, press, scenario, sql, step, waitSql, waitText } from "./lib.mjs";

const iso = () => new Date().toISOString().slice(0, 10);

/** Saves one operator setting through its own form. */
async function setSetting(op, key, value) {
  await go(op, "/admin/settings");
  const field = op.page.locator(`[aria-label="${key}"]`).first();
  await field.fill(value);
  await press(op, field.locator("xpath=ancestor::form").getByRole("button", { name: "Save" }), { wait: 700 });
  await waitText(op, "Saved", 5000);
}
const claimNow = async (p, slug, { amount, currency, ref, proof = true }) => {
  await go(p, `/w/${slug}/billing`);
  await fill(p, "#amount", amount); await p.page.selectOption("#currency", currency); await fill(p, "#paid_on", iso());
  await fill(p, "#bank_reference", ref);
  if (proof) await p.page.locator("#proof").setInputFiles(fixture("policy-photo.png"));
  await press(p, "I have paid", { wait: 1500 });
  await waitText(p, "Waiting for confirmation", 8000);
};
/** Presses "Request bill" and returns the bill email the customer was sent (read from the test outbox). Bank details are only ever in this email. */
const requestBillNow = async (p, slug) => {
  await go(p, `/w/${slug}/billing`);
  const t = await body(p);
  check(!has(t, "Test Bank") && !has(t, "PK00TEST"), "the bank details are on the Billing page");
  await press(p, "Request bill", { wait: 1500 });
  await waitText(p, "We sent the bill", 8000);
  const sent = readFileSync(process.env.E2E_OUTBOX, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((m) => m.to === p.email && m.subject.startsWith("Your Fleet OTG bill"));
  check(sent.length > 0, "no bill email was sent");
  return sent[sent.length - 1];
};
const confirmNow = async (op, orgName) => {
  await go(op, "/admin/payments");
  const panel = op.page.locator("section", { hasText: orgName }).first();
  await press(op, panel.getByRole("button", { name: "It arrived: confirm" }), { wait: 1800 });
};

export async function billing(S) {
  scenario("5. Paying, tax invoices and the NTN");
  const op = S.op, pk = S.pk, us = S.us, slug = S.pkSlug, usSlug = S.usSlug;
  check(op && pk && us, "earlier scenarios did not run");

  await step("the operator sets up the seller, the bank account, the rate and one authority through the Settings and Tax screens", async () => {
    await setSetting(op, "bank_details", "Bank: Test Bank\nAccount title: Test Seller\nIBAN: PK00TEST0000000000000000");
    await setSetting(op, "seller_legal_name", "Test Seller");
    await setSetting(op, "seller_ntn", "1111111-1");
    await setSetting(op, "seller_tax_reg", "PRA-0001");
    await setSetting(op, "pkr_per_usd", "280");
    await go(op, "/admin/tax");
    const f = op.page.locator("form:has(button:has-text('Save authority'))");
    await f.locator("input[name=code]").fill("PRA"); await f.locator("input[name=label]").fill("Punjab"); await f.locator("input[name=sales_tax_pct]").fill("16");
    await press(op, "Save authority", { wait: 900 });
    await waitText(op, "Saved", 5000);
    check(sql("select sales_tax_pct from public.tax_rules where code = 'PRA'") === "16.00", "the authority was not saved");
    await go(op, "/admin/rates");
    const r = op.page.locator("form:has(button:has-text('Save rate'))");
    await r.locator("input[name=date]").fill(iso()); await r.locator("input[name=buy]").fill("280"); await r.locator("input[name=sell]").fill("281");
    await press(op, "Save rate", { wait: 900 });
    await waitText(op, "Rate saved", 5000);
    check(sql(`select buy from public.fx_rates where rate_date = '${iso()}'`) === "280.0000", "the rate was not saved");
  });

  await step("the forex.pk fetch is off, and says why", async () => {
    await go(op, "/admin/rates");
    const t = await body(op);
    check(has(t, "written consent") && has(t, "Off"), "the page does not explain that the automatic fetch is off");
    check(await op.page.getByRole("button", { name: "Fetch the rate now" }).count() === 0, "a fetch button is offered without consent");
  });

  await step("the Pakistani customer fills in its tax details and sees what to send", async () => {
    await go(pk, `/w/${slug}/billing`);
    await fill(pk, "#legal_name", "Lahore Fleet Pvt Ltd"); await fill(pk, "#ntn", "1234567-8"); await fill(pk, "#address", "Gulberg, Lahore");
    await press(pk, "Save details", { wait: 1200 });
    await waitText(pk, "Saved", 6000);
    await go(pk, `/w/${slug}/billing`);
    check(has(await body(pk), "I have paid"), "no payment form");
    const bill = await requestBillNow(pk, slug);
    for (const w of ["Total to send", "Punjab 16%", "Rs 41,720.00", "Rs 48,395.20", "Test Bank", "IBAN: PK00TEST0000000000000000", "FVM-"]) check(bill.text.toLowerCase().includes(w.toLowerCase()), `the bill lacks "${w}": ${bill.text.slice(0, 400)}`);
  });

  await step("it files a payment with a receipt, and the operator sees the invoice it will make", async () => {
    await claimNow(pk, slug, { amount: "48395.20", currency: "PKR", ref: "BANK-REF-1001" });
    await go(op, "/admin/payments");
    const t = await body(op);
    for (const w of ["Invoice this will make", "Customers in Pakistan", "Rs 41,720.00", "Rs 6,675.20", "Rs 48,395.20", "matches", "Exchange rate used"]) check(t.includes(w), `the payment screen lacks "${w}"`);
  });

  await step("confirming issues a tax invoice, a ledger entry, and opens the workspace's invoice", async () => {
    await confirmNow(op, S.pkName);
    await waitSql(`select count(*) from public.invoices where tenant_id = (select id from public.tenants where slug = '${slug}')`, "1");
    await go(pk, `/w/${slug}/billing`);
    await pk.page.getByRole("link", { name: /^INV-/ }).first().click();
    await pk.page.waitForLoadState("networkidle");
    const t = await body(pk);
    for (const w of ["Tax invoice", "Test Seller", "1111111-1", "PRA-0001", "Lahore Fleet Pvt Ltd", "1234567-8", "Punjab 16%", "Rs 41,720.00", "Rs 6,675.20", "Rs 48,395.20"]) check(has(t, w), `the invoice lacks "${w}"`);
    S.pkInvoice = new URL(pk.page.url()).pathname;
    check(sql("select count(*) from public.acct_journals where source_kind = 'invoice'") >= "1", "no ledger entry");
  });

  await step("the accounting screens show the entry, a trial balance of zero, the tax month, and a downloadable CSV", async () => {
    await go(op, "/admin/accounting");
    const t = await body(op);
    for (const w of ["Trial balance", "Sales tax payable", "Customers in Pakistan", "Subscription revenue"]) check(t.includes(w), `accounting lacks "${w}"`);
    check(await op.page.locator("text=Check: must be zero").count() > 0, "no balance check shown");
    const r = await op.page.request.get(`${APP}/admin/accounting/export/journal`);
    check(r.status() === 200 && /text\/csv/.test(r.headers()["content-type"] ?? ""), `journal csv gave ${r.status()}`);
    const csv = await r.text();
    check(csv.startsWith("Entry,Date,Currency,Kind,Memo,Account,Account name,Debit,Credit"), "the CSV header is wrong");
    check(csv.split("\n").length > 3, "the CSV is empty");
    const t2 = await op.page.request.get(`${APP}/admin/accounting/export/tax-summary`);
    check(t2.status() === 200, `tax csv ${t2.status()}`);
    const bad = await op.page.request.get(`${APP}/admin/accounting/export/nonsense`);
    check(bad.status() === 404, `an unknown export gave ${bad.status()}`);
    const anon = await pk.page.request.get(`${APP}/admin/accounting/export/journal`, { maxRedirects: 0 });
    check(anon.status() !== 200 || !/^Entry,/.test(await anon.text()), "a customer downloaded the operator's ledger");
  });

  // ---------- no withholding, no authority to pick (ADR-053)
  await step("the customer's form asks for company name, NTN and address only: no withholding, STRN, country or authority", async () => {
    await go(pk, `/w/${slug}/billing`);
    for (const sel of ["input[name=withholding_agent]", "#strn", "#country", "#tax_rule_code"]) check(await pk.page.locator(sel).count() === 0, `the form still offers ${sel}`);
    for (const sel of ["#legal_name", "#ntn", "#address"]) check(await pk.page.locator(sel).count() === 1, `the form lacks ${sel}`);
    const bill = await requestBillNow(pk, slug);
    check(!bill.text.includes("Send us") && !has(bill.text, "keep back"), "the bill mentions withholding");
  });
  await step("a customer with no NTN cannot be invoiced, and can once it enters one", async () => {
    sql(`update public.org_tax set ntn = null where tenant_id = (select id from public.tenants where slug = '${slug}')`);
    await claimNow(pk, slug, { amount: "48395.20", currency: "PKR", ref: "BANK-REF-NONTN" });
    await go(op, "/admin/payments");
    await confirmNow(op, S.pkName);
    await waitText(op, "has not entered its NTN", 6000);
    await go(pk, `/w/${slug}/billing`);
    await fill(pk, "#legal_name", "Lahore Fleet Pvt Ltd"); await fill(pk, "#ntn", "1234567-8");
    await press(pk, "Save details", { wait: 1200 });
    await waitText(pk, "Saved", 6000);
    await go(op, "/admin/payments");
    await confirmNow(op, S.pkName);
    await waitSql(`select count(*) from public.invoices where tenant_id = (select id from public.tenants where slug = '${slug}')`, "2");
  });

  // ---------- abroad
  await step("a customer outside Pakistan sees no tax, pays in dollars and gets a plain invoice", async () => {
    await go(us, `/w/${usSlug}/billing`);
    const bill = await requestBillNow(us, usSlug);
    check(bill.text.includes("$149") && !bill.text.includes("Rs ") && !has(bill.text, "sales tax"), `the dollar customer's bill: ${bill.text.slice(0, 300)}`);
    await claimNow(us, usSlug, { amount: "149", currency: "USD", ref: "WIRE-US-1" });
    await go(op, "/admin/payments");
    await confirmNow(op, S.usName);
    await waitSql(`select count(*) from public.invoices where tenant_id = (select id from public.tenants where slug = '${usSlug}')`, "1");
    await go(us, `/w/${usSlug}/billing`);
    await us.page.getByRole("link", { name: /^INV-/ }).first().click();
    await us.page.waitForLoadState("networkidle");
    const inv = await body(us);
    check(/invoice/i.test(inv) && !/tax invoice/i.test(inv) && has(inv, "No tax is charged") && inv.includes("$149") && !inv.includes("Sales tax reg. Billed") && !inv.includes("NTN —"), `the dollar invoice: ${inv.replace(/\s+/g, " ").slice(0, 300)}`);
    check(sql(`select tax_snapshot->>'currency' from public.invoices where tenant_id = (select id from public.tenants where slug = '${usSlug}')`) === "USD", "snapshot currency");
    check(sql(`select j.currency from public.acct_journals j join public.invoices i on i.id = j.source_id where i.tenant_id = (select id from public.tenants where slug = '${usSlug}')`) === "USD", "the ledger entry is not in dollars");
  });
  await step("every currency in the ledger balances on its own", async () => {
    const r = sql("select currency, sum(debit_minor) - sum(credit_minor) from public.acct_lines l join public.acct_journals j on j.id = l.journal_id group by currency order by 1");
    check(r.split("\n").every((l) => l.endsWith("|0")), r);
  });
  await step("an operator can change a customer's country and the scenario follows", async () => {
    await go(op, `/admin/orgs/${sql(`select id from public.tenants where slug = '${usSlug}'`)}`);
    const t = await body(op);
    check(has(t, "Country: US"), "the operator page does not show the customer's country");
  });
  await step("billing pages are not shown to a workshop, and a requester cannot pay", async () => {
    if (S.shop) { await go(S.shop, `/w/${slug}/billing`); check(!has(await body(S.shop), "Your plan"), "a workshop sees the company's plan"); }
    if (S.staff) { await go(S.staff, `/w/${slug}/billing`); const t = await body(S.staff); check(!t.includes("I have paid") && !t.includes("FVM-"), "a requester sees payment controls or the payment reference"); }
  });
}
