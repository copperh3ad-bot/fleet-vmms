// The internal ledger for the subscription business (ADR-018). Every invoice posts one balanced journal as it is issued:
//   Dr Bank                      what actually arrived (or what should have, if the amount sent is not known in this currency)
//   Dr Income tax withheld       what the customer kept back as income tax, recoverable against the seller's own tax
//   Dr Sales tax withheld        what the customer kept back of the sales tax
//   Dr/Cr Short and over         the difference between what should have arrived and what did
//   Cr Subscription revenue      the price before tax
//   Cr Sales tax payable         the sales tax charged
// Journals are never edited. A mistake is corrected by a reversing journal. The owner sets the chart of accounts; the application posts
// to the accounts that carry a "role" (bank, revenue, ...), so an account can be renamed or renumbered without breaking posting.
// Amounts are whole minor units (paisa, cents), and each journal is in one currency: a dollar invoice and a rupee invoice do not mix.
import type { Driver, Queryable } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";
import { UserError } from "@/lib/master/service";

export const ROLES = ["BANK", "REVENUE", "SALES_TAX", "WHT_INCOME", "WHT_SALES", "DIFFERENCE"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = {
  BANK: "Bank", REVENUE: "Subscription revenue", SALES_TAX: "Sales tax payable", WHT_INCOME: "Income tax withheld by customers", WHT_SALES: "Sales tax withheld by customers", DIFFERENCE: "Short and over payments",
};
export type Kind = "asset" | "liability" | "income" | "expense" | "equity";
export type Account = { code: string; name: string; kind: Kind; system_key: Role | null; active: boolean };

async function asOperator<T>(driver: Driver, operatorId: string, fn: (q: Queryable) => Promise<T>): Promise<T> {
  return withPlatform(driver, async (q) => {
    if ((await q.query("select 1 from public.platform_admins where user_id = $1", [operatorId])).rows.length === 0) throw new UserError("Not allowed.");
    await q.query("select set_config('app.user_id', $1, true)", [operatorId]);
    return fn(q);
  });
}

type Line = { account: string; debit: number; credit: number };

async function insertJournal(q: Queryable, j: { currency: string; kind: "invoice" | "manual" | "reversal"; sourceId?: string | null; memo: string; by: string | null; reverses?: string | null }, lines: Line[]): Promise<{ id: string; number: string }> {
  const nonzero = lines.filter((l) => l.debit + l.credit > 0);
  const d = nonzero.reduce((s, l) => s + l.debit, 0), c = nonzero.reduce((s, l) => s + l.credit, 0);
  if (nonzero.length < 2 || d !== c) throw new UserError(`The entry does not balance: debits ${d / 100}, credits ${c / 100}.`);
  const head = (await q.query<{ id: string; number: string }>(
    `insert into public.acct_journals(number, currency, source_kind, source_id, memo, created_by, reverses)
     values ('JE-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.acct_journal_seq')::text, 6, '0'), $1, $2, $3, $4, $5, $6) returning id, number`,
    [j.currency, j.kind, j.sourceId ?? null, j.memo, j.by, j.reverses ?? null])).rows[0];
  for (const l of nonzero) await q.query("insert into public.acct_lines(journal_id, account_code, debit_minor, credit_minor) values ($1, $2, $3, $4)", [head.id, l.account, l.debit, l.credit]);
  return head;
}

async function accountFor(q: Queryable, role: Role): Promise<string> {
  const a = (await q.query<{ code: string; active: boolean }>("select code, active from public.acct_accounts where system_key = $1", [role])).rows[0];
  if (!a || !a.active) throw new UserError(`No active account is set up for "${ROLE_LABEL[role]}". Choose one on the Accounting page.`);
  return a.code;
}

/** Posts the journal for one invoice, once. Called as the invoice is issued, and by the backfill for older ones. Returns null if already posted. */
export async function postInvoiceJournal(q: Queryable, invoiceId: string, by: string | null): Promise<{ number: string } | null> {
  if ((await q.query("select 1 from public.acct_journals where source_kind = 'invoice' and source_id = $1", [invoiceId])).rows.length) return null;
  const i = (await q.query<{
    number: string; billed_to: string; amount_cents: string; currency: string; received_minor: string | null; received_currency: string | null;
    subtotal_minor: string | null; sales_tax_minor: string | null; wht_income_minor: string | null; wht_sales_minor: string | null; net_expected_minor: string | null; ccy: string | null;
  }>(`select number, billed_to, amount_cents::text, currency, received_minor::text, received_currency, subtotal_minor::text, sales_tax_minor::text, wht_income_minor::text, wht_sales_minor::text,
            net_expected_minor::text, tax_snapshot->>'currency' as ccy from public.invoices where id = $1`, [invoiceId])).rows[0];
  if (!i) throw new UserError("Invoice not found.");
  const taxed = i.subtotal_minor !== null;
  const ccy = taxed ? (i.ccy ?? "PKR") : i.currency;
  const subtotal = Number(taxed ? i.subtotal_minor : i.amount_cents), tax = Number(i.sales_tax_minor ?? 0), whtI = Number(i.wht_income_minor ?? 0), whtS = Number(i.wht_sales_minor ?? 0);
  const net = taxed ? Number(i.net_expected_minor) : subtotal;
  const bank = i.received_minor !== null && i.received_currency === ccy ? Number(i.received_minor) : net;
  const diff = net - bank;                                                                    // positive: less arrived than should have
  const [aBank, aRev] = [await accountFor(q, "BANK"), await accountFor(q, "REVENUE")];
  const lines: Line[] = [{ account: aBank, debit: bank, credit: 0 }, { account: aRev, debit: 0, credit: subtotal }];
  if (tax > 0) lines.push({ account: await accountFor(q, "SALES_TAX"), debit: 0, credit: tax });
  if (whtI > 0) lines.push({ account: await accountFor(q, "WHT_INCOME"), debit: whtI, credit: 0 });
  if (whtS > 0) lines.push({ account: await accountFor(q, "WHT_SALES"), debit: whtS, credit: 0 });
  if (diff !== 0) lines.push({ account: await accountFor(q, "DIFFERENCE"), debit: diff > 0 ? diff : 0, credit: diff < 0 ? -diff : 0 });
  const j = await insertJournal(q, { currency: ccy, kind: "invoice", sourceId: invoiceId, memo: `Invoice ${i.number}, ${i.billed_to}`, by }, lines);
  return { number: j.number };
}

// ------------------------------------------------------------------------------------------ accounts

export function listAccounts(driver: Driver, operatorId: string): Promise<Account[]> {
  return asOperator(driver, operatorId, async (q) => (await q.query<Account>("select code, name, kind, system_key, active from public.acct_accounts order by code")).rows);
}

export async function saveAccount(driver: Driver, operatorId: string, v: { code: string; name: string; kind: string; role?: string; active: boolean }): Promise<void> {
  const code = v.code.trim().toUpperCase(), name = v.name.trim(), role = (v.role ?? "").trim().toUpperCase();
  if (!/^[0-9A-Z]{2,12}$/.test(code)) throw new UserError("The code is 2 to 12 letters or digits.", { code: "2 to 12 letters or digits" });
  if (name.length < 2 || name.length > 80) throw new UserError("Enter a name.", { name: "Enter a name" });
  if (!["asset", "liability", "income", "expense", "equity"].includes(v.kind)) throw new UserError("Choose the kind.", { kind: "Choose the kind" });
  if (role && !(ROLES as readonly string[]).includes(role)) throw new UserError(`The role is one of: ${ROLES.join(", ")}.`, { role: "Not a known role" });
  if (!v.active && role) throw new UserError("An account that posting uses cannot be switched off. Give its role to another account first.", { active: "Used for posting" });
  await asOperator(driver, operatorId, async (q) => {
    const current = (await q.query<{ system_key: string | null }>("select system_key from public.acct_accounts where code = $1", [code])).rows[0];
    if (!v.active && current?.system_key && current.system_key !== role) throw new UserError("This account is used for posting. Give its role to another account first.", { active: "Used for posting" });
    if (role) await q.query("update public.acct_accounts set system_key = null where system_key = $1 and code <> $2", [role, code]);   // a role has one account
    await q.query(
      `insert into public.acct_accounts(code, name, kind, system_key, active) values ($1, $2, $3, $4, $5)
       on conflict (code) do update set name = excluded.name, kind = excluded.kind, system_key = excluded.system_key, active = excluded.active, updated_at = now()`, [code, name, v.kind, role || null, v.active]);
  });
}

// ------------------------------------------------------------------------------------------ manual entries and reversals

const toMinor = (v: string, field: string): number => {
  const t = v.trim();
  if (t === "") return 0;
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(t)) throw new UserError("Enter an amount like 1250.50.", { [field]: "Enter an amount like 1250.50" });
  return Math.round(Number(t) * 100);
};

export type ManualLine = { account: string; debit: string; credit: string };

export async function postManualJournal(driver: Driver, operatorId: string, v: { currency: string; memo: string; lines: ManualLine[] }): Promise<{ number: string }> {
  if (!/^[A-Z]{3}$/.test(v.currency)) throw new UserError("Use a three-letter currency like PKR or USD.", { currency: "Three letters" });
  if (v.memo.trim().length < 3) throw new UserError("Say what this entry is for.", { memo: "Say what it is for" });
  const lines: Line[] = v.lines.filter((l) => l.account.trim() || l.debit.trim() || l.credit.trim()).map((l, i) => {
    const debit = toMinor(l.debit, `debit${i}`), credit = toMinor(l.credit, `credit${i}`);
    if (debit > 0 && credit > 0) throw new UserError(`Line ${i + 1} has both a debit and a credit.`);
    return { account: l.account.trim().toUpperCase(), debit, credit };
  });
  return asOperator(driver, operatorId, async (q) => {
    for (const l of lines) {
      const a = (await q.query<{ active: boolean }>("select active from public.acct_accounts where code = $1", [l.account])).rows[0];
      if (!a) throw new UserError(`There is no account ${l.account}.`);
      if (!a.active) throw new UserError(`Account ${l.account} is switched off.`);
    }
    return insertJournal(q, { currency: v.currency, kind: "manual", memo: v.memo.trim(), by: operatorId }, lines);
  });
}

export function reverseJournal(driver: Driver, operatorId: string, journalId: string, why: string): Promise<{ number: string }> {
  if (why.trim().length < 3) return Promise.reject(new UserError("Say why it is being reversed.", { memo: "Say why" }));
  return asOperator(driver, operatorId, async (q) => {
    const j = (await q.query<{ number: string; currency: string; source_kind: string }>("select number, currency, source_kind from public.acct_journals where id = $1", [journalId])).rows[0];
    if (!j) throw new UserError("Entry not found.");
    if (j.source_kind === "reversal") throw new UserError("A reversal cannot be reversed. Post the entry again instead.");
    if ((await q.query("select 1 from public.acct_journals where reverses = $1", [journalId])).rows.length) throw new UserError("That entry has already been reversed.");
    const lines = (await q.query<{ account_code: string; debit_minor: string; credit_minor: string }>("select account_code, debit_minor::text, credit_minor::text from public.acct_lines where journal_id = $1 order by id", [journalId])).rows;
    return insertJournal(q, { currency: j.currency, kind: "reversal", memo: `Reverses ${j.number}: ${why.trim().slice(0, 240)}`, by: operatorId, reverses: journalId },
      lines.map((l) => ({ account: l.account_code, debit: Number(l.credit_minor), credit: Number(l.debit_minor) })));
  });
}

/** Posts every invoice that has no journal yet, oldest first. Safe to repeat. */
export function postMissingInvoices(driver: Driver, operatorId: string): Promise<number> {
  return asOperator(driver, operatorId, async (q) => {
    const ids = (await q.query<{ id: string }>(
      "select i.id from public.invoices i where not exists (select 1 from public.acct_journals j where j.source_kind = 'invoice' and j.source_id = i.id) order by i.issued_at, i.number")).rows;
    for (const r of ids) await postInvoiceJournal(q, r.id, operatorId);
    return ids.length;
  });
}

// ------------------------------------------------------------------------------------------ reports

export type JournalRow = { id: string; number: string; posted_at: string; currency: string; source_kind: string; memo: string; reversed: boolean; lines: { account_code: string; account_name: string; debit_minor: string; credit_minor: string }[] };

export function listJournals(driver: Driver, operatorId: string, opts: { limit?: number; from?: string; to?: string } = {}): Promise<JournalRow[]> {
  return asOperator(driver, operatorId, async (q) => {
    const heads = (await q.query<Omit<JournalRow, "lines">>(
      `select j.id, j.number, j.posted_at::text, j.currency, j.source_kind, j.memo, exists (select 1 from public.acct_journals r where r.reverses = j.id) as reversed
         from public.acct_journals j where ($1::date is null or j.posted_at >= $1::date) and ($2::date is null or j.posted_at < $2::date + 1) order by j.posted_at desc, j.number desc limit $3`,
      [opts.from ?? null, opts.to ?? null, Math.min(Math.max(opts.limit ?? 50, 1), 2000)])).rows;
    if (heads.length === 0) return [];
    const lines = (await q.query<{ journal_id: string; account_code: string; account_name: string; debit_minor: string; credit_minor: string }>(
      `select l.journal_id, l.account_code, a.name as account_name, l.debit_minor::text, l.credit_minor::text from public.acct_lines l join public.acct_accounts a on a.code = l.account_code
        where l.journal_id = any($1::uuid[]) order by l.id`, [heads.map((h) => h.id)])).rows;
    return heads.map((h) => ({ ...h, lines: lines.filter((l) => l.journal_id === h.id).map((l) => ({ account_code: l.account_code, account_name: l.account_name, debit_minor: l.debit_minor, credit_minor: l.credit_minor })) }));
  });
}

export type TrialRow = { currency: string; account_code: string; account_name: string; kind: string; debit_minor: string; credit_minor: string; balance_minor: string };

/** Debits, credits and the balance of every account that has an entry, by currency, up to the end of a day. */
export function trialBalance(driver: Driver, operatorId: string, asOf?: string): Promise<TrialRow[]> {
  return asOperator(driver, operatorId, async (q) => (await q.query<TrialRow>(
    `select j.currency, a.code as account_code, a.name as account_name, a.kind, sum(l.debit_minor)::text as debit_minor, sum(l.credit_minor)::text as credit_minor,
            (sum(l.debit_minor) - sum(l.credit_minor))::text as balance_minor
       from public.acct_lines l join public.acct_journals j on j.id = l.journal_id join public.acct_accounts a on a.code = l.account_code
      where ($1::date is null or j.posted_at < $1::date + 1) group by j.currency, a.code, a.name, a.kind order by j.currency, a.code`, [asOf ?? null])).rows);
}

export type TaxSummaryRow = {
  month: string; currency: string; scenario: string; invoices: number; subtotal_minor: string; sales_tax_minor: string; wht_income_minor: string; wht_sales_minor: string; certificates_held: number; certificates_missing: number;
};

/** What tax was charged and withheld, by month and scenario: the figures a return is prepared from. Invoices made without tax are listed too, with zero tax. */
export function taxSummary(driver: Driver, operatorId: string, opts: { from?: string; to?: string } = {}): Promise<TaxSummaryRow[]> {
  return asOperator(driver, operatorId, async (q) => (await q.query<TaxSummaryRow>(
    `select to_char(date_trunc('month', i.issued_at), 'YYYY-MM') as month, coalesce(i.tax_snapshot->>'currency', case when i.subtotal_minor is null then i.currency else 'PKR' end) as currency,
            coalesce(i.tax_snapshot->'scenario'->>'label', 'No scenario (before tax set-up)') as scenario, count(*)::int as invoices,
            coalesce(sum(coalesce(i.subtotal_minor, i.amount_cents)), 0)::text as subtotal_minor, coalesce(sum(i.sales_tax_minor), 0)::text as sales_tax_minor,
            coalesce(sum(i.wht_income_minor), 0)::text as wht_income_minor, coalesce(sum(i.wht_sales_minor), 0)::text as wht_sales_minor,
            count(*) filter (where c.invoice_id is not null)::int as certificates_held,
            count(*) filter (where c.invoice_id is null and (coalesce(i.wht_income_minor, 0) > 0 or coalesce(i.wht_sales_minor, 0) > 0))::int as certificates_missing
       from public.invoices i left join public.invoice_certificates c on c.invoice_id = i.id
      where ($1::date is null or i.issued_at >= $1::date) and ($2::date is null or i.issued_at < $2::date + 1) group by 1, 2, 3 order by 1 desc, 2, 3`, [opts.from ?? null, opts.to ?? null])).rows);
}

// ------------------------------------------------------------------------------------------ export for the accountant

const csvCell = (v: string | number | null): string => { const s = v === null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (rows: (string | number | null)[][]): string => rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
const amount = (m: string | number) => (Number(m) / 100).toFixed(2);

export async function journalCsv(driver: Driver, operatorId: string, opts: { from?: string; to?: string } = {}): Promise<string> {
  const js = await listJournals(driver, operatorId, { ...opts, limit: 2000 });
  return csv([["Entry", "Date", "Currency", "Kind", "Memo", "Account", "Account name", "Debit", "Credit"],
    ...js.flatMap((j) => j.lines.map((l) => [j.number, j.posted_at.slice(0, 10), j.currency, j.source_kind, j.memo, l.account_code, l.account_name, amount(l.debit_minor), amount(l.credit_minor)]))]);
}

export async function taxSummaryCsv(driver: Driver, operatorId: string, opts: { from?: string; to?: string } = {}): Promise<string> {
  const rows = await taxSummary(driver, operatorId, opts);
  return csv([["Month", "Currency", "Scenario", "Invoices", "Subtotal", "Sales tax charged", "Income tax withheld", "Sales tax withheld", "Certificates held", "Certificates missing"],
    ...rows.map((r) => [r.month, r.currency, r.scenario, r.invoices, amount(r.subtotal_minor), amount(r.sales_tax_minor), amount(r.wht_income_minor), amount(r.wht_sales_minor), r.certificates_held, r.certificates_missing])]);
}
