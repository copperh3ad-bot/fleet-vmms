// The internal ledger (ADR-018): every invoice posts a balanced journal, nothing is edited, mistakes are reversed, and the reports
// and the accountant's export agree with the journals.
import { beforeAll, describe, expect, it } from "vitest";
import { UserError } from "@/lib/master/service";
import {
  journalCsv, listAccounts, listJournals, postManualJournal, postMissingInvoices, reverseJournal, saveAccount, taxSummary, taxSummaryCsv, trialBalance,
} from "@/lib/billing/accounting";
import { recordCertificate } from "@/lib/billing/tax-data";
import { harness, NOT_OP, OP, today } from "./billing-harness";

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => { h = await harness(); await h.sellerReady("280"); });

const balanceOf = (rows: Awaited<ReturnType<typeof trialBalance>>, ccy: string, code: string) => Number(rows.find((r) => r.currency === ccy && r.account_code === code)?.balance_minor ?? 0);
const sum = (rows: Awaited<ReturnType<typeof trialBalance>>, ccy: string) => rows.filter((r) => r.currency === ccy).reduce((s, r) => s + Number(r.balance_minor), 0);

describe("every invoice posts one balanced journal", () => {
  it("a taxed rupee invoice: bank, revenue and sales tax payable", async () => {
    const c = await h.org("Ledger Lahore", { country: "PK", profile: h.pk() });
    await h.pay(c, { amount: "48395.2", currency: "PKR" });
    const inv = await h.lastInvoice(c);
    const [j] = (await listJournals(h.control, OP)).filter((x) => x.memo.includes(inv.number));
    expect(j).toMatchObject({ currency: "PKR", source_kind: "invoice", reversed: false });
    expect(j.number).toMatch(/^JE-\d{4}-\d{6}$/);
    const by = Object.fromEntries(j.lines.map((l) => [l.account_code, [Number(l.debit_minor), Number(l.credit_minor)]]));
    expect(by).toEqual({ "1000": [4_839_520, 0], "4000": [0, 4_172_000], "2200": [0, 667_520] });
  });

  it("a customer that withholds: the tax kept back is an asset, not cash", async () => {
    await h.set("wht_income_pct_default", "8"); await h.set("wht_sales_share_pct_default", "50");
    const c = await h.org("Ledger Withholder", { country: "PK", profile: h.pk({ withholding_agent: true }) });
    await h.pay(c, { amount: "41720", currency: "PKR" });                                                          // exactly what should arrive
    const inv = await h.lastInvoice(c);
    const j = (await listJournals(h.control, OP)).find((x) => x.memo.includes(inv.number))!;
    const by = Object.fromEntries(j.lines.map((l) => [l.account_code, [Number(l.debit_minor), Number(l.credit_minor)]]));
    expect(by).toEqual({ "1000": [4_172_000, 0], "1200": [333_760, 0], "1210": [333_760, 0], "4000": [0, 4_172_000], "2200": [0, 667_520] });
  });

  it("a customer outside Pakistan: a dollar journal with no tax, kept apart from the rupee ones", async () => {
    const c = await h.org("Ledger Overseas", { country: "US", profile: h.pk({ country: "US", tax_rule_code: "" }) });
    await h.pay(c);
    const inv = await h.lastInvoice(c);
    const j = (await listJournals(h.control, OP)).find((x) => x.memo.includes(inv.number))!;
    expect(j.currency).toBe("USD");
    expect(j.lines.map((l) => [l.account_code, Number(l.debit_minor), Number(l.credit_minor)])).toEqual([["1000", 14900, 0], ["4000", 0, 14900]]);
    const tb = await trialBalance(h.control, OP);
    expect(new Set(tb.map((r) => r.currency))).toEqual(new Set(["PKR", "USD"]));
    expect(sum(tb, "USD")).toBe(0);
    expect(sum(tb, "PKR")).toBe(0);                                                                                 // every currency balances on its own
  });

  it("a payment that is short or over posts the difference instead of hiding it", async () => {
    const c = await h.org("Ledger Short", { country: "PK", profile: h.pk() });
    const before = balanceOf(await trialBalance(h.control, OP), "PKR", "5900");
    await h.pay(c, { amount: "48000", currency: "PKR" });                                                          // Rs 395.20 short
    expect(balanceOf(await trialBalance(h.control, OP), "PKR", "5900")).toBe(before + 39_520);
    const c2 = await h.org("Ledger Over", { country: "PK", profile: h.pk() });
    await h.pay(c2, { amount: "48400", currency: "PKR" });                                                         // Rs 4.80 over
    expect(balanceOf(await trialBalance(h.control, OP), "PKR", "5900")).toBe(before + 39_520 - 480);
    expect(sum(await trialBalance(h.control, OP), "PKR")).toBe(0);
  });

  it("an invoice is posted once, and the backfill posts only the ones that are missing", async () => {
    const c = await h.org("Ledger Backfill", { country: "PK", profile: h.pk() });
    await h.pay(c, { amount: "48395.2", currency: "PKR" });
    expect(await postMissingInvoices(h.control, OP)).toBe(0);
    // an older invoice with no journal (made before the ledger existed)
    const inv = await h.lastInvoice(c);
    await h.control.transaction(async (q) => {
      await q.query("set local search_path = public");
      await q.query("set local session_replication_role = replica");                                              // lets the test remove a journal, which the application never can
      await q.query("delete from public.acct_lines where journal_id in (select id from public.acct_journals where source_id = $1)", [inv.id]);
      await q.query("delete from public.acct_journals where source_id = $1", [inv.id]);
    });
    expect(await postMissingInvoices(h.control, OP)).toBe(1);
    expect(await postMissingInvoices(h.control, OP)).toBe(0);
    expect((await listJournals(h.control, OP)).filter((x) => x.memo.includes(inv.number))).toHaveLength(1);
    await expect(postMissingInvoices(h.control, NOT_OP)).rejects.toThrow("Not allowed.");
  });
});

describe("nothing is edited, the database refuses an unbalanced entry, and a mistake is reversed", () => {
  it("the database itself refuses to change or delete an entry, and to save one that does not balance", async () => {
    const [j] = await listJournals(h.control, OP, { limit: 1 });
    const run = (sql: string, args: unknown[] = []) => h.control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query(sql, args); });
    await expect(run("update public.acct_journals set memo = 'edited' where id = $1", [j.id])).rejects.toThrow(/post a reversal/);
    await expect(run("delete from public.acct_journals where id = $1", [j.id])).rejects.toThrow(/post a reversal/);
    await expect(run("update public.acct_lines set debit_minor = 1 where journal_id = $1", [j.id])).rejects.toThrow(/post a reversal/);
    await expect(run("delete from public.acct_lines where journal_id = $1", [j.id])).rejects.toThrow(/post a reversal/);
    await expect(h.control.transaction(async (q) => {
      await q.query("set local search_path = public");
      const id = (await q.query<{ id: string }>("insert into public.acct_journals(number, currency, source_kind, memo) values ('JE-X-1', 'PKR', 'manual', 'unbalanced test') returning id")).rows[0].id;
      await q.query("insert into public.acct_lines(journal_id, account_code, debit_minor) values ($1, '1000', 500)", [id]);
    })).rejects.toThrow(/does not balance/);
  });

  it("a manual entry must balance, use real accounts and say what it is for; only an operator makes one", async () => {
    const ok = await postManualJournal(h.control, OP, { currency: "PKR", memo: "Bank charges for October", lines: [{ account: "5900", debit: "250.00", credit: "" }, { account: "1000", debit: "", credit: "250" }] });
    expect(ok.number).toMatch(/^JE-/);
    const bad = (lines: { account: string; debit: string; credit: string }[], memo = "Test entry") => postManualJournal(h.control, OP, { currency: "PKR", memo, lines });
    await expect(bad([{ account: "5900", debit: "100", credit: "" }, { account: "1000", debit: "", credit: "90" }])).rejects.toThrow(/does not balance/);
    await expect(bad([{ account: "5900", debit: "100", credit: "" }])).rejects.toThrow(/does not balance/);
    await expect(bad([{ account: "9999", debit: "100", credit: "" }, { account: "1000", debit: "", credit: "100" }])).rejects.toThrow(/no account 9999/);
    await expect(bad([{ account: "5900", debit: "100", credit: "100" }, { account: "1000", debit: "", credit: "100" }])).rejects.toBeInstanceOf(UserError);
    await expect(bad([{ account: "5900", debit: "ten", credit: "" }, { account: "1000", debit: "", credit: "10" }])).rejects.toBeInstanceOf(UserError);
    await expect(bad([{ account: "5900", debit: "100", credit: "" }, { account: "1000", debit: "", credit: "100" }], "x")).rejects.toThrow(/what this entry is for/);
    await expect(postManualJournal(h.control, NOT_OP, { currency: "PKR", memo: "Not allowed", lines: [] })).rejects.toThrow("Not allowed.");
  });

  it("a reversal swaps the sides, ties back to the entry, and can happen once", async () => {
    const made = await postManualJournal(h.control, OP, { currency: "PKR", memo: "Entered by mistake", lines: [{ account: "5900", debit: "75", credit: "" }, { account: "1000", debit: "", credit: "75" }] });
    const before = await trialBalance(h.control, OP);
    const rev = await reverseJournal(h.control, OP, (await listJournals(h.control, OP)).find((j) => j.number === made.number)!.id, "Wrong account");
    const after = await trialBalance(h.control, OP);
    expect(balanceOf(after, "PKR", "5900")).toBe(balanceOf(before, "PKR", "5900") - 7500);
    expect(balanceOf(after, "PKR", "1000")).toBe(balanceOf(before, "PKR", "1000") + 7500);
    const list = await listJournals(h.control, OP);
    expect(list.find((j) => j.number === made.number)?.reversed).toBe(true);
    expect(list.find((j) => j.number === rev.number)).toMatchObject({ source_kind: "reversal" });
    expect(list.find((j) => j.number === rev.number)?.memo).toContain(made.number);
    await expect(reverseJournal(h.control, OP, list.find((j) => j.number === made.number)!.id, "again")).rejects.toThrow(/already been reversed/);
    await expect(reverseJournal(h.control, OP, list.find((j) => j.number === rev.number)!.id, "undo the undo")).rejects.toThrow(/cannot be reversed/);
    await expect(reverseJournal(h.control, OP, list[0].id, "")).rejects.toThrow(/Say why/);
  });
});

describe("the chart of accounts", () => {
  it("is the owner's: add accounts, rename them, move a role; posting follows the role, not the number", async () => {
    expect((await listAccounts(h.control, OP)).map((a) => a.system_key).filter(Boolean).sort()).toEqual(["BANK", "DIFFERENCE", "REVENUE", "SALES_TAX", "WHT_INCOME", "WHT_SALES"]);
    await saveAccount(h.control, OP, { code: "1010", name: "Meezan current account", kind: "asset", role: "BANK", active: true });
    const accounts = await listAccounts(h.control, OP);
    expect(accounts.find((a) => a.code === "1010")?.system_key).toBe("BANK");
    expect(accounts.find((a) => a.code === "1000")?.system_key).toBeNull();                                         // a role has one account
    const c = await h.org("Ledger New Bank", { country: "PK", profile: h.pk() });
    await h.pay(c, { amount: "48395.2", currency: "PKR" });
    const j = (await listJournals(h.control, OP, { limit: 1 }))[0];
    expect(j.lines.some((l) => l.account_code === "1010" && Number(l.debit_minor) > 0)).toBe(true);
    await saveAccount(h.control, OP, { code: "1000", name: "Old bank account", kind: "asset", role: "BANK", active: true });          // and back
  });

  it("an account that posting uses cannot be switched off, and a posting with no account is refused plainly", async () => {
    await expect(saveAccount(h.control, OP, { code: "4000", name: "Subscription revenue", kind: "income", role: "REVENUE", active: false })).rejects.toThrow(/cannot be switched off/);
    await expect(saveAccount(h.control, OP, { code: "4000", name: "Subscription revenue", kind: "income", active: false })).rejects.toThrow(/used for posting/);
    await expect(saveAccount(h.control, OP, { code: "x", name: "Bad", kind: "asset", active: true })).rejects.toBeInstanceOf(UserError);
    await expect(saveAccount(h.control, OP, { code: "7000", name: "Bad kind", kind: "wish", active: true })).rejects.toBeInstanceOf(UserError);
    await expect(saveAccount(h.control, OP, { code: "7000", name: "Bad role", kind: "asset", role: "MAGIC", active: true })).rejects.toBeInstanceOf(UserError);
    await expect(saveAccount(h.control, NOT_OP, { code: "7000", name: "Not allowed", kind: "asset", active: true })).rejects.toThrow("Not allowed.");
    await h.control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.acct_accounts set active = false where code = '2200'"); });
    const c = await h.org("Ledger No Account", { country: "PK", profile: h.pk() });
    await expect(h.pay(c, { amount: "48395.2", currency: "PKR" })).rejects.toThrow(/No active account is set up for "Sales tax payable"/);
    await h.control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.acct_accounts set active = true where code = '2200'"); });
  });
});

describe("reports and the accountant's export", () => {
  it("the tax summary adds up from the invoices, by month and scenario, and counts certificates held and missing", async () => {
    const rows = await taxSummary(h.control, OP);
    const pk = rows.filter((r) => r.scenario === "Customers in Pakistan" && r.currency === "PKR");
    expect(pk.length).toBeGreaterThan(0);
    const invoices = pk.reduce((s, r) => s + r.invoices, 0), tax = pk.reduce((s, r) => s + Number(r.sales_tax_minor), 0), missing = pk.reduce((s, r) => s + r.certificates_missing, 0);
    expect(invoices).toBeGreaterThanOrEqual(5);
    expect(tax).toBeGreaterThan(0);
    expect(missing).toBeGreaterThanOrEqual(1);                                                                      // the withholder above
    const usd = rows.filter((r) => r.currency === "USD");
    expect(usd.every((r) => Number(r.sales_tax_minor) === 0)).toBe(true);
    // the sales tax payable on the trial balance equals the sales tax charged on the invoices
    expect(-balanceOf(await trialBalance(h.control, OP), "PKR", "2200")).toBe(tax);
    // recording the certificate moves it from missing to held
    const owed = (await h.control.transaction(async (q) => (await q.query<{ id: string }>("select i.id from public.invoices i left join public.invoice_certificates c on c.invoice_id = i.id where c.invoice_id is null and coalesce(i.wht_income_minor, 0) > 0 limit 1")).rows))[0];
    await recordCertificate(h.control, OP, owed.id, { certificate_no: "CERT-1", received_on: today() });
    const after = (await taxSummary(h.control, OP)).filter((r) => r.scenario === "Customers in Pakistan" && r.currency === "PKR");
    expect(after.reduce((s, r) => s + r.certificates_missing, 0)).toBe(missing - 1);
    await expect(taxSummary(h.control, NOT_OP)).rejects.toThrow("Not allowed.");
  });

  it("the trial balance can be taken as of a date", async () => {
    expect((await trialBalance(h.control, OP, "2000-01-01")).length).toBe(0);
    expect((await trialBalance(h.control, OP, today())).length).toBeGreaterThan(0);
  });

  it("the CSV has one row for each line of each entry, and quotes what needs quoting", async () => {
    await postManualJournal(h.control, OP, { currency: "PKR", memo: 'Adjustment, "with quotes"', lines: [{ account: "5900", debit: "1", credit: "" }, { account: "1000", debit: "", credit: "1" }] });
    const csv = await journalCsv(h.control, OP);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("Entry,Date,Currency,Kind,Memo,Account,Account name,Debit,Credit");
    expect(lines.some((l) => l.includes('"Adjustment, ""with quotes"""'))).toBe(true);
    const js = await listJournals(h.control, OP, { limit: 2000 });
    expect(lines.length - 1).toBe(js.reduce((s, j) => s + j.lines.length, 0));
    const tcsv = (await taxSummaryCsv(h.control, OP)).trim().split("\n");
    expect(tcsv[0]).toBe("Month,Currency,Scenario,Invoices,Subtotal,Sales tax charged,Income tax withheld,Sales tax withheld,Certificates held,Certificates missing");
    expect(tcsv.length).toBeGreaterThan(1);
    await expect(journalCsv(h.control, NOT_OP)).rejects.toThrow("Not allowed.");
  });
});
