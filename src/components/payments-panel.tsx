"use client";
import { useActionState, useState } from "react";
import { keepForm } from "@/components/keep-form";
import { Field, Notice, Select, inputCls } from "@/components/form";
import { Pill } from "@/components/ui";
import { dmy } from "@/lib/format/date";
import { APPROVAL_TEXT, PAY_METHODS, type PaymentSummary } from "@/lib/payments/types";
import type { FormState } from "@/app/w/[slug]/actions-util";
import { approvePaymentAction, recordPaymentAction, voidPaymentAction } from "@/app/w/[slug]/invoices/payment-actions";

const amt = (n: number | string) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const METHOD = Object.fromEntries(PAY_METHODS) as Record<string, string>;
const STATUS = { not_checked: ["Not checked yet", "neutral"], unpaid: ["Unpaid", "warn"], part_paid: ["Part paid", "warn"], paid: ["Paid in full", "ok"] } as const;
const today = () => new Date().toISOString().slice(0, 10);

function PayForm({ slug, kind, invoiceId, remaining, currency }: { slug: string; kind: string; invoiceId: string; remaining: number; currency: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(recordPaymentAction.bind(null, slug, kind, invoiceId), {});
  return (
    <form onSubmit={keepForm(action)} className="space-y-3 border-t border-zinc-100 pt-4">
      <p className="text-sm font-medium">Record a payment</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Amount (${currency})`} name="amount" state={state} required hint={`Up to ${amt(remaining)}`}>
          <input id="amount" name="amount" inputMode="decimal" defaultValue={state.values?.amount ?? String(remaining)} className={inputCls} aria-invalid={!!state.fields?.amount} />
        </Field>
        <Field label="Date paid" name="paid_on" state={state} required>
          <input id="paid_on" name="paid_on" type="date" max={today()} defaultValue={state.values?.paid_on ?? today()} className={inputCls} aria-invalid={!!state.fields?.paid_on} />
        </Field>
        <Select name="method" label="How it was paid" state={state} required options={PAY_METHODS.map(([k, l]) => [k, l])} blank="Choose" />
        <Field label="Reference" name="reference" state={state} hint="Cheque number or transfer id. Not needed for cash.">
          <input id="reference" name="reference" defaultValue={state.values?.reference ?? ""} maxLength={80} className={inputCls} aria-invalid={!!state.fields?.reference} />
        </Field>
      </div>
      <Field label="Note" name="note" state={state}>
        <textarea id="note" name="note" rows={2} defaultValue={state.values?.note ?? ""} maxLength={500} className={`${inputCls} h-auto py-2`} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="inline-flex h-10 items-center rounded-md bg-brand px-5 text-sm font-medium text-white disabled:opacity-60">{pending ? "Saving" : "Record payment"}</button>
        <Notice state={state} />
      </div>
    </form>
  );
}

function VoidForm({ slug, paymentId }: { slug: string; paymentId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(voidPaymentAction.bind(null, slug, paymentId), {});
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs text-red-800 underline">Void</button>;
  return (
    <form onSubmit={keepForm(action)} className="mt-2 space-y-2">
      <label htmlFor={`why-${paymentId}`} className="block text-xs font-medium text-zinc-600">Why is this payment void? <span className="text-red-700">*</span></label>
      <input id={`why-${paymentId}`} name="reason" defaultValue={state.values?.reason ?? ""} className={inputCls} aria-invalid={!!state.fields?.reason} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="inline-flex h-9 items-center rounded-md bg-red-700 px-4 text-sm font-medium text-white disabled:opacity-60">{pending ? "Saving" : "Void payment"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm underline">Cancel</button>
        <Notice state={state} />
      </div>
    </form>
  );
}

function ApproveForm({ slug, kind, invoiceId, needsReason }: { slug: string; kind: string; invoiceId: string; needsReason: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(approvePaymentAction.bind(null, slug, kind, invoiceId), {});
  return (
    <form onSubmit={keepForm(action)} className="space-y-2">
      <label htmlFor="approve-note" className="block text-xs font-medium text-zinc-600">Reason{needsReason ? <span className="text-red-700"> *</span> : " (optional)"}</label>
      <input id="approve-note" name="note" defaultValue={state.values?.note ?? ""} maxLength={300} className={inputCls} aria-invalid={!!state.fields?.note} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="inline-flex h-10 items-center rounded-md bg-brand px-5 text-sm font-medium text-white disabled:opacity-60">{pending ? "Saving" : "Approve this payment"}</button>
        <Notice state={state} />
      </div>
    </form>
  );
}

/** The payments recorded against one checked invoice, what is left to pay, and the form to record the next one (ADR-086). */
export function PaymentsPanel({ slug, summary, currency }: { slug: string; summary: PaymentSummary; currency: string }) {
  const [label, tone] = STATUS[summary.status];
  const live = summary.payments.filter((p) => !p.voided_at);
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2"><Pill tone={tone}>{label}</Pill>
        {summary.due !== null && <span className="text-zinc-600">Due {currency} <span className="font-mono">{amt(summary.due)}</span> · paid <span className="font-mono">{amt(summary.paid)}</span>{summary.remaining ? <> · left <span className="font-mono font-semibold">{amt(summary.remaining)}</span></> : null}</span>}
      </div>
      {summary.payments.length === 0 ? <p className="text-zinc-500">{summary.due === null ? "Payments can be recorded once the invoice is checked." : "No payment recorded yet."}</p> : (
        <ul className="divide-y divide-zinc-100">
          {summary.payments.map((p) => (
            <li key={p.id} className={`py-3 ${p.voided_at ? "text-zinc-400" : ""}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className={`font-mono ${p.voided_at ? "line-through" : "font-semibold text-zinc-900"}`}>{currency} {amt(p.amount)}</span>
                <span className="text-xs">{p.payment_no} · {dmy(p.paid_on)}</span>
              </div>
              <p className="text-xs">{METHOD[p.method] ?? p.method}{p.reference ? `, ${p.reference}` : ""} · recorded by {p.paid_by_name ?? "someone"}{p.note ? ` · ${p.note}` : ""}</p>
              {p.voided_at
                ? <p className="text-xs text-red-800">Void ({dmy(p.voided_at)}) by {p.voided_by_name ?? "someone"}: {p.void_reason}</p>
                : summary.canPay && <VoidForm slug={slug} paymentId={p.id} />}
            </li>))}
        </ul>
      )}
      {summary.approval.needed && (
        <div role="status" className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
          <p className="font-medium">{summary.approval.approvedBy ? `Approved for payment by ${summary.approval.approvedBy}` : "Needs approval before it can be paid"}</p>
          <p className="text-xs">{APPROVAL_TEXT[summary.approval.needed]}{summary.approval.note ? ` Reason given: ${summary.approval.note}` : ""}</p>
          {summary.approval.canApprove && <ApproveForm slug={slug} kind={summary.kind} invoiceId={summary.invoiceId} needsReason={summary.approval.needed !== "amount"} />}
        </div>
      )}
      {summary.blocked && <p role="status" className="rounded-md bg-amber-100 p-3 text-amber-800">{summary.blocked}</p>}
      {summary.canPay && !summary.blocked && summary.remaining ? <PayForm key={live.length} slug={slug} kind={summary.kind} invoiceId={summary.invoiceId} remaining={summary.remaining} currency={currency} /> : null}
    </div>
  );
}
