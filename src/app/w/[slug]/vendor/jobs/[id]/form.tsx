"use client";
import { useActionState } from "react";
import { Card, Field, Input, Notice, Submit, inputCls } from "@/components/form";
import { LinesEditor } from "@/components/lines-editor";
import type { FormState } from "../../../actions-util";
import { submitQuotationAction } from "../../actions";

export function QuotationForm({ slug, jobId }: { slug: string; jobId: string }) {
  const [state, action] = useActionState<FormState, FormData>(submitQuotationAction.bind(null, slug, jobId), {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <Card title="Your price">
        <LinesEditor title="Quotation" errors={state.fields} />
      </Card>
      <Card title="Terms">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input name="days_needed" label="Days needed" state={state} inputMode="numeric" />
          <Input name="valid_until" label="Price valid until" type="date" state={state} />
          <Input name="warranty_months" label="Warranty (months)" state={state} inputMode="numeric" />
        </div>
        <div className="mt-3">
          <Field label="Notes" name="details" state={state}>
            <textarea id="details" name="details" rows={2} defaultValue={state.values?.details ?? ""} className={`${inputCls} h-auto py-2`} />
          </Field>
        </div>
      </Card>
      <Notice state={state} />
      <Submit>Send quotation</Submit>
    </form>
  );
}
