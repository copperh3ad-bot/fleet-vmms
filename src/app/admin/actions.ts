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
import { recordCertificate, saveTaxRule, setOrgWithholding } from "@/lib/billing/tax-data";
import { providerFromEnv } from "@/lib/orgs/db-provider";
import type { FormState } from "@/app/w/[slug]/actions-util";

async function run(fn: (operatorId: string) => Promise<string>): Promise<FormState> {
  const op = await requireOperator();
  try {
    const ok = await fn(op.id);
    refresh();
    return { ok };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, fields: e.fields };
    throw e;
  }
}
const text = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function confirmClaimAction(claimId: string, _p: FormState, f: FormData): Promise<FormState> {
  return run(async (op) => { const r = await confirmClaim(getDriver(), op, claimId, { months: Number(text(f, "months")) || undefined, note: text(f, "note") || undefined }); return `Confirmed. Invoice ${r.number}.`; });
}

export async function rejectClaimAction(claimId: string, _p: FormState, f: FormData): Promise<FormState> {
  return run(async (op) => { await rejectClaim(getDriver(), op, claimId, text(f, "note")); return "Rejected."; });
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
