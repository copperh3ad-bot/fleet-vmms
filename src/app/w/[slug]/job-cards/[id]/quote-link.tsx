"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Notice } from "@/components/form";
import { btn } from "@/components/ui";
import { smsLink, whatsappLink } from "@/lib/phone";
import { createQuoteLinkAction, type QuoteLinkState } from "../actions";

function Go({ again }: { again: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className={`${btn} disabled:opacity-60`}>{pending ? "Making the link" : again ? "Make a new link" : "Send the workshop a link for the estimate"}</button>;
}

/** Makes a single-use link to the workshop's phone number. The link is not printed; it goes out through the sender's own WhatsApp or messages app. */
export function QuoteLink({ slug, jobId, vendor }: { slug: string; jobId: string; vendor: string }) {
  const [state, action] = useActionState<QuoteLinkState, FormData>(createQuoteLinkAction.bind(null, slug, jobId), {});
  const send = state.send;
  return (
    <div className="mb-3 space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm">
      <p className="text-zinc-700">{vendor} can send the estimate from a phone with a link that works once. The estimate is recorded against this job card.</p>
      <form action={action}><Go again={!!send} /></form>
      {send && (
        <div className="space-y-2">
          <p>Ready for {send.vendor}, to <span className="font-mono">{send.display}</span>. The link goes to this number only and is not shown here.</p>
          <div className="flex flex-wrap gap-2">
            <a className={btn} href={whatsappLink(send.digits, send.text)} target="_blank" rel="noreferrer">Send on WhatsApp</a>
            <a className={btn} href={smsLink(send.e164, send.text)}>Send as a text message</a>
          </div>
        </div>
      )}
      <Notice state={send ? { ...state, ok: undefined } : state} />
    </div>
  );
}
