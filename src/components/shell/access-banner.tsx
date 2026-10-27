import { accessMessage, type Access } from "@/lib/billing/state";
import { TrialCountdown } from "./trial-countdown";

const TONE = { info: "border-sky-200 bg-sky-100 text-sky-900", warn: "border-amber-200 bg-amber-50 text-amber-900", bad: "border-red-200 bg-red-50 text-red-900" } as const;

/** One plain line about the trial or the subscription, shown above every page while it matters. While a free trial runs it is a live countdown to the moment it ends. */
export function AccessBanner({ slug, access }: { slug: string; access?: Access }) {
  const msg = access ? accessMessage(access) : null;
  if (!msg) return null;
  if (access?.state === "trial" && access.trialMsLeft && access.trialMsLeft > 0) return <TrialCountdown slug={slug} msLeft={access.trialMsLeft} fallback={msg.text} />;
  return (
    <p role="status" className={`mx-6 mt-4 flex flex-wrap items-center gap-x-3 rounded-md border px-4 py-2.5 text-sm ${TONE[msg.tone]}`}>
      <span>{msg.text}</span>
      <a href={`/w/${slug}/billing`} className="font-medium underline">{access?.state === "trial" ? "Subscribe" : "Billing"}</a>
    </p>
  );
}
