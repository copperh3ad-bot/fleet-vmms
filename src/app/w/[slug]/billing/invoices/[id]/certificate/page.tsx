import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { getInvoice } from "@/lib/billing/payments";
import { getCertificateForInvoice, CERTIFICATE_DISCLAIMER } from "@/lib/billing/certificates";
import { CertificateDocument } from "@/components/certificate-document";
import { PrintButton } from "../print-button";
import { IssueCertificateForm } from "./form";

export default function CertificatePage({ params }: PageProps<"/w/[slug]/billing/invoices/[id]/certificate">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const m = await requireMembership(slug, { allowLocked: true });
  const driver = getDriver();
  const [inv, cert] = await Promise.all([getInvoice(driver, m, id), getCertificateForInvoice(driver, m, id)]);
  if (!inv) notFound();
  const withheld = inv.tax ? Number(inv.tax.wht_income_minor) + Number(inv.tax.wht_sales_minor) : 0;
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6 text-zinc-900">
      <div className="flex items-center justify-between print:hidden"><a href={`/w/${slug}/billing/invoices/${id}`} className="text-sm underline">Back to the invoice</a>{cert && <PrintButton />}</div>
      {cert ? <CertificateDocument c={cert} /> : withheld > 0 ? (
        <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6">
          <h1 className="text-xl font-semibold">Withholding certificate for {inv.number}</h1>
          <p className="text-sm text-zinc-700">You kept back tax from this payment. Enter where you deposited it and we prepare the certificate from the figures on the invoice, ready to sign and send to the supplier.</p>
          <IssueCertificateForm slug={slug} invoiceId={id} />
          <p className="text-xs text-zinc-500">{CERTIFICATE_DISCLAIMER}</p>
        </section>
      ) : <p className="rounded-md border border-zinc-200 bg-white p-6 text-sm text-zinc-600">No tax was withheld on this invoice, so there is no certificate to issue.</p>}
    </main>
  );
}
