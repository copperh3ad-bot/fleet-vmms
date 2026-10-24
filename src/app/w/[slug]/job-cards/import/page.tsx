import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { forbidden } from "next/navigation";
import { getDriver } from "@/lib/db";
import { PageHeader, Panel, btn } from "@/components/ui";
import { ImportForm } from "./form";

export default function ImportPage({ params }: PageProps<"/w/[slug]/job-cards/import">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  if (!(await permissionsOf(getDriver(), m)).has("jobcard.create")) forbidden();
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6 text-zinc-900">
      <PageHeader crumb={<><a className="underline" href={`/w/${slug}/job-cards`}>Job cards</a> / Offline form</>} title="Offline job card form" sub="Fill it in without a connection, print it, or send it to someone in the field. Then upload it here." />
      <Panel title="1. Get the form">
        <p className="text-sm text-zinc-700">An Excel file with drop-down lists of your vehicles and reasons. It works in Excel, Google Sheets, and the Excel phone app, and prints on one A4 page.</p>
        <p className="mt-3"><a href={`/w/${slug}/job-cards/form`} className={btn}>Download the blank form</a></p>
      </Panel>
      <Panel title="2. Fill it in">
        <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700">
          <li>One form is one job card. Make a copy of the file for each job.</li>
          <li>Fill the yellow cells. Choose from the lists; the starred ones are needed.</li>
          <li>Do not add, move or delete rows. The form is locked to stop that.</li>
          <li>Download a fresh blank form now and then, so your vehicles and reasons are up to date.</li>
        </ul>
      </Panel>
      <Panel title="3. Upload it" sub="Each file becomes a draft job card. Nothing is sent for approval until you open the draft and submit it.">
        <ImportForm slug={slug} />
      </Panel>
    </main>
  );
}
