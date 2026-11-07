import { dmyTime as when } from "@/lib/format/date";
import { Suspense } from "react";
import { requireOperator } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listContactMessages } from "@/lib/contact";
import { PageHeader, Panel, Pill } from "@/components/ui";
import { markContactHandledAction } from "../actions";
import { ToggleButton } from "../forms";

export default function MessagesPage() {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner /></Suspense>;
}

const TOPIC: Record<string, string> = { sales: "Before signing up", support: "Account help", billing: "Payment or invoice", other: "Other" };

async function Inner() {
  const op = await requireOperator();
  const rows = await listContactMessages(getDriver(), op.id);
  const fresh = rows.filter((r) => r.status === "new").length;
  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6 text-zinc-900">
      <PageHeader title="Messages" sub={`From the Contact us page. ${fresh} waiting. Reply from your own email, then mark it handled.`} />
      {rows.length === 0 ? <Panel><p className="text-sm text-zinc-500">No messages yet.</p></Panel> : rows.map((r) => (
        <Panel key={r.id} title={r.name} sub={`${when(r.created_at)}${r.company ? ` · ${r.company}` : ""}`} action={<Pill tone={r.status === "new" ? "warn" : "neutral"}>{r.status === "new" ? "New" : "Handled"}</Pill>}>
          <p className="text-sm"><span className="text-zinc-500">{TOPIC[r.topic] ?? r.topic} · </span><a className="underline" href={`mailto:${r.email}`}>{r.email}</a></p>
          <p className="mt-3 whitespace-pre-wrap text-sm">{r.message}</p>
          {r.status === "new" && <p className="mt-4"><ToggleButton action={markContactHandledAction.bind(null, r.id)} label="Mark handled" /></p>}
        </Panel>
      ))}
    </main>
  );
}
