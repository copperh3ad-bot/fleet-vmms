import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOperator } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { getCertificateForOperator } from "@/lib/billing/certificates";
import { CertificateDocument } from "@/components/certificate-document";
import { PrintButton } from "@/app/w/[slug]/billing/invoices/[id]/print-button";
import { Panel } from "@/components/ui";
import { voidCertificateAction } from "../../actions";
import { MiniForm } from "../../forms";

export default function CertificatePage({ params }: PageProps<"/admin/certificates/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const op = await requireOperator();
  const c = await getCertificateForOperator(getDriver(), op.id, id);
  if (!c) notFound();
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6 text-zinc-900">
      <div className="flex items-center justify-between print:hidden"><a href="/admin/tax" className="text-sm underline">Back to Tax</a><PrintButton /></div>
      <CertificateDocument c={c} />
      {c.status === "issued" && (
        <div className="print:hidden">
          <Panel title="Void this certificate" sub="A certificate cannot be edited. If something is wrong, void it; the tax becomes owed again and a new one can be issued.">
            <MiniForm action={voidCertificateAction.bind(null, c.id)} button="Void" danger fields={[{ name: "reason", label: "Why", width: "w-96" }]} />
          </Panel>
        </div>
      )}
    </main>
  );
}
