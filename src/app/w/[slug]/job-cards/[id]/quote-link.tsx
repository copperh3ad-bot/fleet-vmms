"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Notice } from "@/components/form";
import { btn } from "@/components/ui";
import { smsLink, whatsappLink } from "@/lib/phone";
import { createWorkshopLinkAction, emailWorkshopLinkAction, type QuoteLinkState } from "../actions";

type Kind = "quotation" | "invoice";

function Go({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className={`${btn} disabled:opacity-60`}>{pending ? pendingLabel : label}</button>;
}

/**
 * Asks the workshop for its estimate or its invoice with a single-use link (ADR-030, ADR-033). Workshops are added by the organization and never
 * sign up. The link is not printed: it goes out through the sender's own WhatsApp or messages app, or by email to the workshop's own address.
 */
export function QuoteLink({ slug, jobId, vendor, kind }: { slug: string; jobId: string; vendor: string; kind: Kind }) {
  const [phone, phoneAction] = useActionState<QuoteLinkState, FormData>(createWorkshopLinkAction.bind(null, slug, jobId, kind), {});
  const [mail, mailAction] = useActionState<QuoteLinkState, FormData>(emailWorkshopLinkAction.bind(null, slug, jobId, kind), {});
  const send = phone.send;
  const what = kind === "quotation" ? "estimate" : "invoice";
  return (
    <div className="mb-3 space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm">
      <p className="text-zinc-700">{vendor} does not need an account. It can send the {what} with a link that works once, by phone or from an email. {kind === "invoice" ? "Sending the invoice also records the work as done. " : ""}The {what} is recorded against this job card.</p>
      <div className="flex flex-wrap gap-2">
        <form action={phoneAction}><Go label={`Send the link by phone`} pendingLabel="Making the link" /></form>
        <form action={mailAction}><Go label={`Email the link`} pendingLabel="Sending the email" /></form>
      </div>
      {send && (
        <div className="space-y-2">
          <p>Ready for {send.vendor}, to <span className="font-mono">{send.display}</span>. The link goes to this number only and is not shown here.</p>
          <div className="flex flex-wrap gap-2">
            <a className={btn} href={whatsappLink(send.digits, send.text)} target="_blank" rel="noreferrer">Send on WhatsApp</a>
            <a className={btn} href={smsLink(send.e164, send.text)}>Send as a text message</a>
          </div>
        </div>
      )}
      <Notice state={send ? { ...phone, ok: undefined } : phone} />
      <Notice state={mail} />
    </div>
  );
}
