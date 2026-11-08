"use server";
// Everything the platform operator can do (ADR-014). Each action starts with requireOperator(), and the services check it
// again inside their own transaction. Errors come back as plain messages.
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { requireOperator } from "@/lib/auth/session";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { UserError } from "@/lib/master/service";
import { confirmClaim, deleteOrganization, extendTrial, proofLink, recordManualPayment, rejectClaim, setComped, setSuspended } from "@/lib/billing/operator";
import { savePlatformSetting } from "@/lib/billing/settings";
import { notifyClaimDecided } from "@/lib/billing/payment-mails";
import { setOrgPlan, setPlanPrice, setProBands } from "@/lib/billing/plans";
import { markContactHandled } from "@/lib/contact";
import { recordCertificate, saveTaxRule, setOrgCountry, setOrgWithholding } from "@/lib/billing/tax-data";
import { saveScenario } from "@/lib/billing/tax-scenarios";
import { fetchInterbankRate, saveRate } from "@/lib/billing/fx";
import { postManualJournal, postMissingInvoices, reverseJournal, saveAccount } from "@/lib/billing/accounting";
import { issueCertificate, voidCertificate } from "@/lib/billing/certificates";
import { providerFromEnv } from "@/lib/orgs/db-provider";
import { callerName, type FormState } from "@/app/w/[slug]/actions-util";
import { logActivity } from "@/lib/activity/log";

async function run(fn: (operatorId: string) => Promise<string>): Promise<FormState> {
  const name = callerName() ?? "operator action";
  const t0 = Date.now();
  const op = await requireOperator();
  const base = { kind: "billing" as const, name, actorId: op.id, role: "operator" };         // everything an operator does is on the record (ADR-070)
  try {
    const ok = await fn(op.id);
    await logActivity({ ...base, outcome: "ok", durationMs: Date.now() - t0 });
    refresh();
    return { ok };
  } catch (e) {
    if (e instanceof UserError) {
      await logActivity({ ...base, outcome: "invalid", durationMs: Date.now() - t0, details: { message: e.message } });
      return { error: e.message, fields: e.fields };
    }
    await logActivity({ ...base, outcome: "error", durationMs: Date.now() - t0, error: e });
    throw e;
  }
}
const text = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function confirmClaimAction(claimId: string, _p: FormState, f: FormData): Promise<FormState> {
  return run(async (op) => {
    const note = text(f, "note") || undefined;
    const r = await confirmClaim(getDriver(), op, claimId, { months: Number(text(f, "months")) || undefined, note });
    await notifyClaimDecided(getDriver(), claimId, { kind: "confirmed", invoiceNumber: r.number, periodEnd: r.periodEnd, note });          // the customer and the Billing mailbox are told; a mail problem never undoes this
    return `Confirmed. Invoice ${r.number}.`;
  });
}

export async function rejectClaimAction(claimId: string, _p: FormState, f: FormData): Promise<FormState> {
  return run(async (op) => {
    await rejectClaim(getDriver(), op, claimId, text(f, "note"));
    await notifyClaimDecided(getDriver(), claimId, { kind: "rejected", why: text(f, "note").trim() });
    return "Rejected.";
  });
}

export async function extendTrialAction(tenantId: string, _p: FormState, f: FormData): Promise<FormState> {
  return run(async (op) => { await extendTrial(getDriver(), op, tenantId, Number(text(f, "days"))); return "Trial extended."; });
}

export async function manualPaymentAction(tenantId: string, _p: FormState, f: FormData): Promise<FormState> {
  return run(async (op) => { const r = await recordManualPayment(getDriver(), op, tenantId, Number(text(f, "months")), text(f, "note")); return `Recorded. Invoice ${r.number}.`; });
}

export async function setSuspendedAction(tenantId: string, suspended: boolean): Promise<FormState> {
  return run(async (op) => { await setSuspended(getDriver(), op, tenantId, suspended); return suspended ? "Locked." : "Unlocked."; });
}

export async function setCompedAction(tenantId: string, comped: boolean): Promise<FormState> {
  return run(async (op) => { await setComped(getDriver(), op, tenantId, comped); return comped ? "Billing waived." : "Billing back on."; });
}

export async function deleteOrganizationAction(tenantId: string, _p: FormState, f: FormData): Promise<FormState> {
  return run(async (op) => { await deleteOrganization(getDriver(), providerFromEnv(), op, tenantId, text(f, "typed")); return "Deleted."; });
}

export async function saveSettingAction(key: string, _p: FormState, f: FormData): Promise<FormState> {
  return run(async (op) => { await savePlatformSetting(getDriver(), op, key, text(f, "value")); return "Saved."; });
}

/** The receipt a customer uploaded, as a short-lived link. Only an operator gets one. */
export async function proofLinkAction(claimId: string): Promise<string | null> {
  const op = await requireOperator();
  return proofLink(getDriver(), await supabaseBlobStore(), op.id, claimId).catch(() => null);
}

export async function saveTaxRuleAction(_p: FormState, f: FormData): Promise<FormState> {
  return run(async (op) => {
    await saveTaxRule(getDriver(), op, { code: text(f, "code"), label: text(f, "label"), sales_tax_pct: text(f, "sales_tax_pct"), active: !/^(no|off|false|0)$/i.test(text(f, "active").trim()) });
    return "Saved.";
  });
}

export async function recordCertificateAction(invoiceId: string, _p: FormState, f: FormData): Promise<FormState> {
  return run(async (op) => { await recordCertificate(getDriver(), op, invoiceId, { certificate_no: text(f, "certificate_no"), received_on: text(f, "received_on") }); return "Recorded."; });
}

export async function setOrgWithholdingAction(tenantId: string, _p: FormState, f: FormData): Promise<FormState> {
  return run(async (op) => { await setOrgWithholding(getDriver(), op, tenantId, { income_pct: text(f, "income_pct"), sales_share_pct: text(f, "sales_share_pct") }); return "Saved."; });
}

export async function saveScenarioAction(_p: FormState, f: FormData): Promise<FormState> {
  return run(async (op) => {
    await saveScenario(getDriver(), op, {
      code: text(f, "code"), label: text(f, "label"), priority: text(f, "priority"), countries: text(f, "countries"), sales_tax_mode: text(f, "sales_tax_mode"), sales_tax_pct: text(f, "sales_tax_pct"),
      tax_name: text(f, "tax_name"), currency: text(f, "currency").toUpperCase(), withholding_allowed: yes(text(f, "withholding_allowed")), seller_registration: text(f, "seller_registration"),
      document_title: text(f, "document_title"), note: text(f, "note"), active: !no(text(f, "active")),
    });
    return "Saved.";
  });
}
const yes = (v: string) => /^(yes|y|on|true|1)$/i.test(v.trim());
const no = (v: string) => /^(no|n|off|false|0)$/i.test(v.trim());

export async function setCountryAction(tenantId: string, _p: FormState, f: FormData): Promise<FormState> {
  return run(async (op) => { await setOrgCountry(getDriver(), op, tenantId, text(f, "country")); return "Saved."; });
}

export async function saveRateAction(_p: FormState, f: FormData): Promise<FormState> {
  return run(async (op) => { await saveRate(getDriver(), op, { date: text(f, "date"), buy: text(f, "buy"), sell: text(f, "sell"), note: text(f, "note") }); return "Rate saved."; });
}

export async function markContactHandledAction(id: string): Promise<FormState> {
  return run(async (op) => { await markContactHandled(getDriver(), op, id); return "Marked handled."; });
}

export async function fetchRateAction(): Promise<FormState> {
  return run(async (op) => {
    const r = await fetchInterbankRate(getDriver(), op);
    return r.stored ? `Stored the rate for ${r.date}: buying ${r.buy}, selling ${r.sell}.` : `The rate for ${r.date} was entered by hand, so it was kept.`;
  });
}

export async function saveAccountAction(_p: FormState, f: FormData): Promise<FormState> {
  return run(async (op) => { await saveAccount(getDriver(), op, { code: text(f, "code"), name: text(f, "name"), kind: text(f, "kind").toLowerCase(), role: text(f, "role"), active: !no(text(f, "active")) }); return "Saved."; });
}

export async function postManualAction(_p: FormState, f: FormData): Promise<FormState> {
  return run(async (op) => {
    const lines = [0, 1, 2, 3].map((i) => ({ account: text(f, `account${i}`), debit: text(f, `debit${i}`), credit: text(f, `credit${i}`) }));
    const r = await postManualJournal(getDriver(), op, { currency: text(f, "currency").toUpperCase(), memo: text(f, "memo"), lines });
    return `Posted ${r.number}.`;
  });
}

export async function reverseJournalAction(journalId: string, _p: FormState, f: FormData): Promise<FormState> {
  return run(async (op) => { const r = await reverseJournal(getDriver(), op, journalId, text(f, "memo")); return `Reversed as ${r.number}.`; });
}

export async function backfillLedgerAction(): Promise<FormState> {
  return run(async (op) => { const n = await postMissingInvoices(getDriver(), op); return n ? `Posted ${n} invoice${n === 1 ? "" : "s"}.` : "Nothing was missing."; });
}

export async function issueCertificateForCustomerAction(invoiceId: string, _p: FormState, f: FormData): Promise<FormState> {
  return run(async (op) => {
    const r = await issueCertificate(getDriver(), { kind: "operator", operatorId: op }, invoiceId, { deposit_reference: text(f, "deposit_reference"), deposit_date: text(f, "deposit_date"), note: text(f, "note") });
    return `Certificate ${r.number} issued.`;
  });
}

export async function voidCertificateAction(id: string, _p: FormState, f: FormData): Promise<FormState> {
  return run(async (op) => { await voidCertificate(getDriver(), op, id, text(f, "reason")); return "Voided."; });
}

/** The owner prices Basic (ADR-035). The price lives in the plans table; nothing here knows a number. */
export async function setPlanPriceAction(key: string, _p: FormState, f: FormData): Promise<FormState> {
  return run(async (op) => { await setPlanPrice(getDriver(), op, key, { price: text(f, "price"), currency: text(f, "currency"), trialDays: text(f, "trial_days") }); return "Saved."; });
}

/** The owner moves one organization to Basic or Pro, for a test, a gift or a correction. */
export async function setOrgPlanAction(tenantId: string, key: string): Promise<FormState> {
  return run(async (op) => { await setOrgPlan(getDriver(), op, tenantId, key); return key === "pro" ? "Moved to Pro." : "Moved to Basic."; });
}

/** The owner sets Pro's fleet-size bands, or empties them to take Pro off sale (ADR-035). Every number comes from the form. */
export async function setProBandsAction(_p: FormState, f: FormData): Promise<FormState> {
  const rows = Array.from({ length: 5 }, (_, i) => ({ upTo: text(f, `up_to_${i}`), price: text(f, `price_${i}`), reads: text(f, `reads_${i}`) }));
  return run(async (op) => { await setProBands(getDriver(), op, rows, text(f, "currency") || "USD"); return rows.some((r) => r.price.trim() || r.upTo.trim() || r.reads.trim()) ? "Pro bands saved." : "Pro is off sale."; });
}
