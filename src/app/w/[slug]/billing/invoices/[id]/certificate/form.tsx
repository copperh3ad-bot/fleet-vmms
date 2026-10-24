"use client";
import { useActionState } from "react";
import { Input, Notice, Submit } from "@/components/form";
import type { FormState } from "../../../../actions-util";
import { issueCertificateAction } from "../../../actions";

export function IssueCertificateForm({ slug, invoiceId }: { slug: string; invoiceId: string }) {
  const [state, action] = useActionState<FormState, FormData>(issueCertificateAction.bind(null, slug, invoiceId), {});
  return (
    <form action={action} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input name="deposit_reference" label="Challan or payment slip number" state={state} required hint="What the tax was deposited with." />
        <Input name="deposit_date" label="Date deposited" type="date" state={state} required />
      </div>
      <Input name="note" label="Note (optional)" state={state} />
      <div className="flex flex-wrap items-center gap-3"><Submit pendingText="Preparing">Prepare the certificate</Submit><Notice state={state} /></div>
    </form>
  );
}
