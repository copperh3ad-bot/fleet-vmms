import { pageMeta } from "@/lib/site";
import { Suspense } from "react";
import { SiteShell } from "@/components/site-shell";
import { normalizeCode } from "@/lib/orgs/join";
import { JoinForm } from "../form";

export const metadata = pageMeta("Join as a workshop · Fleet OTG", "Join a company's Fleet OTG as a workshop, with the code the company gave you, to receive jobs and send quotations.");

export default function JoinWorkshopPage({ searchParams }: PageProps<"/join/workshop">) {
  return <Suspense fallback={<SiteShell active="join"><p className="p-6 text-sm text-zinc-500">Loading</p></SiteShell>}><Inner searchParams={searchParams} /></Suspense>;
}

async function Inner({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const code = typeof sp.code === "string" ? normalizeCode(sp.code).slice(0, 10) : "";
  return (
    <SiteShell active="join">
      <div className="mx-auto grid max-w-5xl gap-10 px-5 py-12 md:grid-cols-[1.2fr_1fr]">
        <section>
          <h1 className="text-3xl font-semibold">Join as a workshop</h1>
          <p className="mt-2 text-zinc-600">A company that sends you its vehicles has given you its code. Enter it to ask for a workshop login. The company approves you.</p>
          <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-6"><JoinForm kind="workshop" code={code} /></div>
        </section>
        <aside className="space-y-5 text-sm">
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="font-semibold">What you can do once approved</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-zinc-700">
              <li>See the jobs the company sends to your workshop, and nothing else of theirs.</li>
              <li>Send quotations and invoices for those jobs.</li>
              <li>Follow each job until it is paid.</li>
            </ul>
            <p className="mt-3 text-zinc-600">There is no charge to workshops.</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="font-semibold">Not a workshop?</h2>
            <p className="mt-2 text-zinc-600">Staff of a company use <a href="/join" className="underline">the staff form</a>.</p>
          </div>
        </aside>
      </div>
    </SiteShell>
  );
}
