import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { PageHeader, Panel, Pill } from "@/components/ui";
import { listPolicies } from "@/lib/master/policy";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { PolicyRemove, PolicyUpload } from "./forms";

export default function PolicyPage({ params }: PageProps<"/w/[slug]/policy">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  const driver = getDriver();
  const [perms, versions] = await Promise.all([permissionsOf(driver, m), supabaseBlobStore().then((s) => listPolicies(driver, s, m))]);
  const manage = perms.has("policy.manage");
  const [current, ...earlier] = versions;

  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Maintenance policy" sub="Your company's own rules for keeping vehicles on the road" />
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Panel title="Current policy">
            {current ? (
              <div className="space-y-2 text-sm">
                <p className="text-base font-medium">{current.title} <Pill tone="ok">Current</Pill></p>
                <p className="text-zinc-600">{current.effective_from ? `Effective from ${day(current.effective_from)} · ` : ""}Uploaded {day(current.created_at)}</p>
                {current.notes && <p className="text-zinc-700">{current.notes}</p>}
                <p className="flex flex-wrap items-center gap-4">
                  {current.file?.url ? <a href={current.file.url} target="_blank" rel="noreferrer" className="font-medium text-sky-800 underline">Open {current.file.file_name}</a> : <span className="text-zinc-500">File not available.</span>}
                  {manage && <PolicyRemove slug={slug} id={current.id} />}
                </p>
              </div>
            ) : <p className="text-sm text-zinc-500">{manage ? "No policy uploaded yet. Add your company's policy on the right." : "Your company has not uploaded a maintenance policy yet."}</p>}
          </Panel>

          {earlier.length > 0 && (
            <Panel title="Earlier versions" flush>
              <ul className="divide-y divide-zinc-100 text-sm">
                {earlier.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <span>{p.title}<span className="block text-xs text-zinc-500">{p.effective_from ? `Effective ${day(p.effective_from)} · ` : ""}Uploaded {day(p.created_at)}</span></span>
                    <span className="flex items-center gap-4">
                      {p.file?.url && <a href={p.file.url} target="_blank" rel="noreferrer" className="text-sky-800 underline">Open</a>}
                      {manage && <PolicyRemove slug={slug} id={p.id} />}
                    </span>
                  </li>))}
              </ul>
            </Panel>
          )}
        </div>

        {manage && (
          <Panel title={current ? "Upload a new version" : "Upload your policy"} sub="The newest upload becomes the current policy. Earlier ones are kept.">
            <PolicyUpload slug={slug} />
          </Panel>
        )}
      </div>
    </main>
  );
}
