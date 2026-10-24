import { Suspense } from "react";
import type { Metadata } from "next";
import { SiteShell } from "@/components/site-shell";
import { normalizeCode } from "@/lib/orgs/join";
import { JoinForm } from "./form";

export const metadata: Metadata = { title: "Join your company · Fleet OTG" };

export default function JoinPage({ searchParams }: PageProps<"/join">) {
  return <Suspense fallback={<SiteShell active="join"><p className="p-6 text-sm text-zinc-500">Loading</p></SiteShell>}><Inner searchParams={searchParams} /></Suspense>;
}

async function Inner({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const code = typeof sp.code === "string" ? normalizeCode(sp.code).slice(0, 10) : "";
  return (
    <SiteShell active="join">
      <div className="mx-auto grid max-w-5xl gap-10 px-5 py-12 md:grid-cols-[1.2fr_1fr]">
        <section>
          <h1 className="text-3xl font-semibold">Join your company</h1>
          <p className="mt-2 text-zinc-600">Your company already uses Fleet OTG. Enter its code and ask to join. Your administrator approves you.</p>
          <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-6"><JoinForm kind="staff" code={code} /></div>
        </section>
        <aside className="space-y-5 text-sm">
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="font-semibold">What happens next</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-zinc-700">
              <li>You confirm your email address.</li>
              <li>Your administrator sees your request and chooses your role.</li>
              <li>Sign in. You will see the invitation waiting for you. Accept it and you are in.</li>
            </ol>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="font-semibold">Not the right place?</h2>
            <p className="mt-2 text-zinc-600">Running a workshop that repairs a company&apos;s vehicles? <a href="/join/workshop" className="underline">Join as a workshop</a>. Want to use Fleet OTG for your own company? <a href="/signup" className="underline">Start a free trial</a>.</p>
          </div>
        </aside>
      </div>
    </SiteShell>
  );
}
